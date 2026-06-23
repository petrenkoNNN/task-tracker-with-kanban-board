import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  describeTaskUpdate,
  hashPassword,
  httpError,
  normalizeChoice,
  normalizeLogin,
  normalizeMaterials,
  normalizeNullableId,
  publicUser,
  requireText,
  verifyPassword
} from "./store.js";

const { Pool } = pg;

const STATUS_TITLES = {
  todo: "К выполнению",
  inprog: "В работе",
  done: "Готово"
};

export class PostgresStore {
  constructor({ connectionString }) {
    this.pool = new Pool({ connectionString });
  }

  async init() {
    const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
    await this.pool.query(readFileSync(schemaPath, "utf8"));
  }

  async close() {
    await this.pool.end();
  }

  async register({ login, password, name }) {
    const normalizedLogin = normalizeLogin(login);
    if (!normalizedLogin) throw httpError(400, "Логин должен быть не короче 3 символов");
    if (String(password ?? "").length < 6) throw httpError(400, "Пароль должен быть не короче 6 символов");

    return this.transaction(async (client) => {
      const userResult = await client.query(
        `INSERT INTO users (login, name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, login, name, created_at`,
        [normalizedLogin, String(name ?? "").trim() || normalizedLogin, hashPassword(password)]
      ).catch((error) => {
        if (error.code === "23505") throw httpError(409, "Такой логин уже занят");
        throw error;
      });
      const user = publicUser(rowToUser(userResult.rows[0]));

      const workspaceResult = await client.query(
        `INSERT INTO workspaces (name, owner_id)
         VALUES ($1, $2)
         RETURNING id`,
        ["Мой workspace", user.id]
      );
      const workspaceId = workspaceResult.rows[0].id;
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [workspaceId, user.id]
      );
      await client.query(
        `INSERT INTO projects (workspace_id, name)
         VALUES ($1, 'Канбан')`,
        [workspaceId]
      );
      return user;
    });
  }

  async login({ login, password }) {
    const result = await this.pool.query(
      `SELECT id, login, name, password_hash, created_at
       FROM users
       WHERE login = $1`,
      [normalizeLogin(login)]
    );
    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) throw httpError(401, "Неверный логин или пароль");
    const token = randomBytes(32).toString("hex");
    await this.pool.query(
      `INSERT INTO sessions (token, user_id) VALUES ($1, $2)`,
      [token, row.id]
    );
    return { token, user: publicUser(rowToUser(row)) };
  }

  async logout(token) {
    await this.pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }

  async getUserBySession(token) {
    const result = await this.pool.query(
      `SELECT users.id, users.login, users.name, users.created_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = $1`,
      [token]
    );
    return result.rows[0] ? publicUser(rowToUser(result.rows[0])) : null;
  }

  async listWorkspaces(userId) {
    const result = await this.pool.query(
      `SELECT workspaces.id,
              workspaces.name,
              workspaces.owner_id,
              workspaces.created_at,
              workspace_members.role,
              COUNT(all_members.user_id)::int AS member_count
       FROM workspace_members
       JOIN workspaces ON workspaces.id = workspace_members.workspace_id
       JOIN workspace_members all_members ON all_members.workspace_id = workspaces.id
       WHERE workspace_members.user_id = $1
       GROUP BY workspaces.id, workspace_members.role
       ORDER BY workspaces.id`,
      [userId]
    );
    return result.rows.map(rowToWorkspace);
  }

  async createWorkspace({ userId, name }) {
    const workspaceName = String(name ?? "").trim();
    if (!workspaceName) throw httpError(400, "Название workspace обязательно");
    return this.transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO workspaces (name, owner_id)
         VALUES ($1, $2)
         RETURNING id, name, owner_id, created_at`,
        [workspaceName, userId]
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [result.rows[0].id, userId]
      );
      return rowToWorkspace({ ...result.rows[0], role: "owner", member_count: 1 });
    });
  }

  async addWorkspaceMember({ userId, workspaceId, login }) {
    await this.assertOwner(userId, workspaceId);
    const target = await this.findUserByLogin(login);
    if (!target) throw httpError(404, "Пользователь с таким логином не найден");
    await this.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [workspaceId, target.id]
    ).catch((error) => {
      if (error.code === "23505") throw httpError(409, "Пользователь уже добавлен");
      throw error;
    });
    return publicUser(target);
  }

  async listMembers(userId, workspaceId) {
    await this.assertMember(userId, workspaceId);
    const result = await this.pool.query(
      `SELECT users.id, users.login, users.name, users.created_at, workspace_members.role
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
       WHERE workspace_members.workspace_id = $1
       ORDER BY workspace_members.role DESC, users.name`,
      [workspaceId]
    );
    return result.rows.map((row) => ({ ...publicUser(rowToUser(row)), role: row.role }));
  }

  async listProjects(userId, workspaceId) {
    await this.assertMember(userId, workspaceId);
    const result = await this.pool.query(
      `SELECT id, workspace_id, name, created_at
       FROM projects
       WHERE workspace_id = $1
       ORDER BY id`,
      [workspaceId]
    );
    return result.rows.map(rowToProject);
  }

  async createProject({ userId, workspaceId, name }) {
    await this.assertMember(userId, workspaceId);
    const projectName = String(name ?? "").trim();
    if (!projectName) throw httpError(400, "Название проекта обязательно");
    const result = await this.pool.query(
      `INSERT INTO projects (workspace_id, name)
       VALUES ($1, $2)
       RETURNING id, workspace_id, name, created_at`,
      [workspaceId, projectName]
    );
    return rowToProject(result.rows[0]);
  }

  async listTasks(userId, { workspaceId, projectId, search = "", tag = "", mode = "active" }) {
    await this.assertMember(userId, workspaceId);
    const values = [workspaceId];
    const where = ["projects.workspace_id = $1", mode === "deferred" ? "tasks.deferred = TRUE" : "tasks.deferred = FALSE"];
    if (projectId) {
      values.push(projectId);
      where.push(`tasks.project_id = $${values.length}`);
    }
    if (tag) {
      values.push(tag);
      where.push(`tasks.tag = $${values.length}`);
    }
    const normalizedSearch = String(search).trim().toLowerCase();
    if (normalizedSearch) {
      values.push(`%${normalizedSearch}%`);
      where.push(`LOWER(tasks.title || ' ' || tasks.description || ' ' || tasks.tag) LIKE $${values.length}`);
    }
    const result = await this.pool.query(
      `SELECT tasks.*
       FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE ${where.join(" AND ")}
       ORDER BY tasks.updated_at DESC, tasks.id DESC`,
      values
    );
    return Promise.all(result.rows.map((row) => this.hydrateTask(row)));
  }

  async createTask(userId, workspaceId, payload) {
    await this.assertMember(userId, workspaceId);
    const project = await this.assertProjectInWorkspace(payload.projectId, workspaceId);
    const checklist = normalizeNestedChecklist(payload.checklist);
    const materials = normalizeNestedMaterials(payload.materials);
    const result = await this.pool.query(
      `INSERT INTO tasks
        (project_id, title, description, tag, priority, assignee_id, due_date, status, checklist, materials, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
       RETURNING *`,
      [
        project.id,
        requireText(payload.title, "Название задачи обязательно"),
        String(payload.description ?? "").trim(),
        payload.tag || "frontend",
        normalizeChoice(payload.priority, ["low", "medium", "high"], "medium"),
        normalizeNullableId(payload.assigneeId),
        payload.dueDate || null,
        normalizeChoice(payload.status, ["todo", "inprog", "done"], "todo"),
        JSON.stringify(checklist),
        JSON.stringify(materials),
        userId
      ]
    );
    await this.addHistory(result.rows[0].id, userId, "created", `Создал задачу в проекте «${project.name}»`);
    return this.hydrateTask(result.rows[0]);
  }

  async updateTask(userId, workspaceId, taskId, payload) {
    const task = await this.assertTaskAccess(userId, workspaceId, taskId);
    const before = rowToTask(task);
    const nextChecklist = normalizeNestedChecklist(payload.checklist);
    const nextStatus = normalizeChoice(payload.status, ["todo", "inprog", "done"], "todo");
    if (nextStatus === "done" && nextChecklist.some((item) => !item.done)) {
      throw httpError(400, "Нельзя закрыть задачу, пока чеклист не выполнен");
    }
    const materials = normalizeNestedMaterials(payload.materials);
    const result = await this.pool.query(
      `UPDATE tasks
       SET title = $1,
           description = $2,
           tag = $3,
           priority = $4,
           assignee_id = $5,
           due_date = $6,
           status = $7,
           checklist = $8::jsonb,
           materials = $9::jsonb,
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        requireText(payload.title, "Название задачи обязательно"),
        String(payload.description ?? "").trim(),
        payload.tag || "frontend",
        normalizeChoice(payload.priority, ["low", "medium", "high"], "medium"),
        normalizeNullableId(payload.assigneeId),
        payload.dueDate || null,
        nextStatus,
        JSON.stringify(nextChecklist),
        JSON.stringify(materials),
        task.id
      ]
    );
    const updated = rowToTask(result.rows[0]);
    await this.addHistory(task.id, userId, "updated", describeTaskUpdate(before, updated));
    return this.hydrateTask(result.rows[0]);
  }

  async moveTask(userId, workspaceId, taskId, status) {
    const task = await this.assertTaskAccess(userId, workspaceId, taskId);
    const current = rowToTask(task);
    const nextStatus = normalizeChoice(status, ["todo", "inprog", "done"], current.status);
    if (nextStatus === "done" && current.checklist.some((item) => !item.done)) {
      throw httpError(400, "Нельзя закрыть задачу, пока чеклист не выполнен");
    }
    const result = await this.pool.query(
      `UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [nextStatus, task.id]
    );
    await this.addHistory(task.id, userId, "moved", `Переместил из «${STATUS_TITLES[current.status]}» в «${STATUS_TITLES[nextStatus]}»`);
    return this.hydrateTask(result.rows[0]);
  }

  async deferTask(userId, workspaceId, taskId, { reason, until }) {
    const task = await this.assertTaskAccess(userId, workspaceId, taskId);
    const deferredReason = requireText(reason, "Причина отложения обязательна");
    const result = await this.pool.query(
      `UPDATE tasks
       SET deferred = TRUE, deferred_reason = $1, deferred_until = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [deferredReason, until || null, task.id]
    );
    await this.addHistory(task.id, userId, "deferred", `Отложил задачу: ${deferredReason}`);
    return this.hydrateTask(result.rows[0]);
  }

  async restoreTask(userId, workspaceId, taskId) {
    const task = await this.assertTaskAccess(userId, workspaceId, taskId);
    const result = await this.pool.query(
      `UPDATE tasks
       SET deferred = FALSE, deferred_reason = '', deferred_until = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [task.id]
    );
    await this.addHistory(task.id, userId, "restored", "Вернул задачу на доску");
    return this.hydrateTask(result.rows[0]);
  }

  async deleteTask(userId, workspaceId, taskId) {
    const task = await this.assertTaskAccess(userId, workspaceId, taskId);
    await this.pool.query(`DELETE FROM tasks WHERE id = $1`, [task.id]);
  }

  async addComment(userId, workspaceId, taskId, text) {
    const task = await this.assertTaskAccess(userId, workspaceId, taskId);
    const result = await this.pool.query(
      `INSERT INTO comments (task_id, user_id, text)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, user_id, text, created_at`,
      [task.id, userId, requireText(text, "Комментарий не может быть пустым")]
    );
    await this.addHistory(task.id, userId, "commented", "Добавил комментарий");
    return this.hydrateComment(result.rows[0]);
  }

  async toggleChecklist(userId, workspaceId, taskId, itemId) {
    const task = await this.assertTaskAccess(userId, workspaceId, taskId);
    const current = rowToTask(task);
    const item = current.checklist.find((entry) => entry.id === itemId);
    if (!item) throw httpError(404, "Пункт чеклиста не найден");
    item.done = !item.done;
    const result = await this.pool.query(
      `UPDATE tasks SET checklist = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [JSON.stringify(current.checklist), task.id]
    );
    await this.addHistory(task.id, userId, "checklist", `${item.done ? "Выполнил" : "Вернул"} пункт «${item.text}»`);
    return this.hydrateTask(result.rows[0]);
  }

  async addHistory(taskId, userId, action, details) {
    await this.pool.query(
      `INSERT INTO task_history (task_id, user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [taskId, userId, action, details]
    );
  }

  async hydrateTask(row) {
    const task = rowToTask(row);
    const [assignee, createdByUser, comments, history] = await Promise.all([
      task.assigneeId ? this.findUserById(task.assigneeId) : null,
      this.findUserById(task.createdBy),
      this.listComments(task.id),
      this.listHistory(task.id)
    ]);
    return {
      ...task,
      assignee: assignee ? publicUser(assignee) : null,
      createdByUser: createdByUser ? publicUser(createdByUser) : null,
      comments,
      history
    };
  }

  async hydrateComment(row) {
    const user = await this.findUserById(row.user_id);
    return {
      id: row.id,
      taskId: row.task_id,
      userId: row.user_id,
      text: row.text,
      createdAt: toIso(row.created_at),
      user: user ? publicUser(user) : null
    };
  }

  async listComments(taskId) {
    const result = await this.pool.query(
      `SELECT id, task_id, user_id, text, created_at
       FROM comments
       WHERE task_id = $1
       ORDER BY created_at ASC, id ASC`,
      [taskId]
    );
    return Promise.all(result.rows.map((row) => this.hydrateComment(row)));
  }

  async listHistory(taskId) {
    const result = await this.pool.query(
      `SELECT task_history.id,
              task_history.task_id,
              task_history.user_id,
              task_history.action,
              task_history.details,
              task_history.created_at,
              users.login,
              users.name
       FROM task_history
       JOIN users ON users.id = task_history.user_id
       WHERE task_history.task_id = $1
       ORDER BY task_history.created_at ASC, task_history.id ASC`,
      [taskId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      userId: row.user_id,
      action: row.action,
      details: row.details,
      createdAt: toIso(row.created_at),
      user: publicUser({ id: row.user_id, login: row.login, name: row.name })
    }));
  }

  async assertOwner(userId, workspaceId) {
    const membership = await this.assertMember(userId, workspaceId);
    if (membership.role !== "owner") throw httpError(403, "Добавлять участников может только владелец");
  }

  async assertMember(userId, workspaceId) {
    const result = await this.pool.query(
      `SELECT workspace_id, user_id, role
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );
    if (!result.rows[0]) throw httpError(403, "Нет доступа к workspace");
    return result.rows[0];
  }

  async assertProjectInWorkspace(projectId, workspaceId) {
    const result = await this.pool.query(
      `SELECT id, workspace_id, name, created_at
       FROM projects
       WHERE id = $1 AND workspace_id = $2`,
      [Number(projectId), workspaceId]
    );
    if (!result.rows[0]) throw httpError(404, "Проект не найден");
    return rowToProject(result.rows[0]);
  }

  async assertTaskAccess(userId, workspaceId, taskId) {
    await this.assertMember(userId, workspaceId);
    const result = await this.pool.query(
      `SELECT tasks.*
       FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.id = $1 AND projects.workspace_id = $2`,
      [Number(taskId), workspaceId]
    );
    if (!result.rows[0]) throw httpError(404, "Задача не найдена");
    return result.rows[0];
  }

  async findUserByLogin(login) {
    const result = await this.pool.query(
      `SELECT id, login, name, created_at FROM users WHERE login = $1`,
      [normalizeLogin(login)]
    );
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  }

  async findUserById(id) {
    const result = await this.pool.query(
      `SELECT id, login, name, created_at FROM users WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? rowToUser(result.rows[0]) : null;
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizeNestedChecklist(items) {
  const idProvider = createJsonIdProvider(items);
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: Number(item.id) || idProvider.issueId(),
      text: String(item.text ?? "").trim(),
      done: Boolean(item.done)
    }))
    .filter((item) => item.text)
    .slice(0, 12);
}

function normalizeNestedMaterials(items) {
  const idProvider = createJsonIdProvider(items);
  return normalizeMaterials(items, { issueId: () => idProvider.issueId() });
}

function createJsonIdProvider(items) {
  let next = Math.max(0, ...(Array.isArray(items) ? items.map((item) => Number(item.id) || 0) : [])) + 1;
  return {
    issueId() {
      const id = next;
      next += 1;
      return id;
    }
  };
}

function rowToUser(row) {
  return {
    id: row.id,
    login: row.login,
    name: row.name,
    createdAt: toIso(row.created_at)
  };
}

function rowToWorkspace(row) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: toIso(row.created_at),
    role: row.role,
    memberCount: row.member_count
  };
}

function rowToProject(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: toIso(row.created_at)
  };
}

function rowToTask(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    tag: row.tag,
    priority: row.priority,
    assigneeId: row.assignee_id,
    dueDate: toDateInput(row.due_date),
    status: row.status,
    deferred: row.deferred,
    deferredReason: row.deferred_reason,
    deferredUntil: toDateInput(row.deferred_until),
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    materials: Array.isArray(row.materials) ? row.materials : [],
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toDateInput(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function toIso(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
