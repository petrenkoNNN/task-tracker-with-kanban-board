import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DEFAULT_DB = {
  nextIds: {
    user: 1,
    workspace: 1,
    project: 1,
    task: 1,
    comment: 1,
    history: 1,
    checklist: 1,
    material: 1
  },
  users: [],
  sessions: [],
  workspaces: [],
  members: [],
  projects: [],
  tasks: [],
  comments: [],
  history: []
};

const STATUS_TITLES = {
  todo: "К выполнению",
  inprog: "В работе",
  done: "Готово"
};

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.db = loadDb(filePath);
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.db, null, 2));
  }

  issueId(type) {
    const id = this.db.nextIds[type] ?? 1;
    this.db.nextIds[type] = id + 1;
    return id;
  }

  register({ login, password, name }) {
    const normalizedLogin = normalizeLogin(login);
    if (!normalizedLogin) throw httpError(400, "Логин должен быть не короче 3 символов");
    if (String(password ?? "").length < 6) throw httpError(400, "Пароль должен быть не короче 6 символов");
    if (this.db.users.some((user) => user.login === normalizedLogin)) throw httpError(409, "Такой логин уже занят");

    const user = {
      id: this.issueId("user"),
      login: normalizedLogin,
      name: String(name ?? "").trim() || normalizedLogin,
      passwordHash: hashPassword(password),
      createdAt: nowIso()
    };
    this.db.users.push(user);

    const workspace = this.createWorkspace({ userId: user.id, name: "Мой workspace" }, false);
    this.createProject({ userId: user.id, workspaceId: workspace.id, name: "Канбан" }, false);
    this.save();
    return publicUser(user);
  }

  login({ login, password }) {
    const user = this.db.users.find((item) => item.login === normalizeLogin(login));
    if (!user || !verifyPassword(password, user.passwordHash)) throw httpError(401, "Неверный логин или пароль");
    const session = {
      token: randomBytes(32).toString("hex"),
      userId: user.id,
      createdAt: nowIso()
    };
    this.db.sessions.push(session);
    this.save();
    return { token: session.token, user: publicUser(user) };
  }

  logout(token) {
    this.db.sessions = this.db.sessions.filter((session) => session.token !== token);
    this.save();
  }

  getUserBySession(token) {
    const session = this.db.sessions.find((item) => item.token === token);
    if (!session) return null;
    const user = this.db.users.find((item) => item.id === session.userId);
    return user ? publicUser(user) : null;
  }

  listWorkspaces(userId) {
    const memberships = this.db.members.filter((member) => member.userId === userId);
    return memberships.map((member) => {
      const workspace = this.db.workspaces.find((item) => item.id === member.workspaceId);
      return {
        ...workspace,
        role: member.role,
        memberCount: this.db.members.filter((item) => item.workspaceId === member.workspaceId).length
      };
    }).filter((workspace) => workspace.id);
  }

  createWorkspace({ userId, name }, persist = true) {
    const workspaceName = String(name ?? "").trim();
    if (!workspaceName) throw httpError(400, "Название workspace обязательно");
    const workspace = {
      id: this.issueId("workspace"),
      name: workspaceName,
      ownerId: userId,
      createdAt: nowIso()
    };
    this.db.workspaces.push(workspace);
    this.db.members.push({ workspaceId: workspace.id, userId, role: "owner", addedAt: nowIso() });
    if (persist) this.save();
    return workspace;
  }

  addWorkspaceMember({ userId, workspaceId, login }) {
    this.assertOwner(userId, workspaceId);
    const target = this.db.users.find((item) => item.login === normalizeLogin(login));
    if (!target) throw httpError(404, "Пользователь с таким логином не найден");
    if (this.db.members.some((item) => item.workspaceId === workspaceId && item.userId === target.id)) {
      throw httpError(409, "Пользователь уже добавлен");
    }
    this.db.members.push({ workspaceId, userId: target.id, role: "member", addedAt: nowIso() });
    this.save();
    return publicUser(target);
  }

  listMembers(userId, workspaceId) {
    this.assertMember(userId, workspaceId);
    return this.db.members
      .filter((member) => member.workspaceId === workspaceId)
      .map((member) => {
        const user = this.db.users.find((item) => item.id === member.userId);
        return { ...publicUser(user), role: member.role };
      });
  }

  listProjects(userId, workspaceId) {
    this.assertMember(userId, workspaceId);
    return this.db.projects.filter((project) => project.workspaceId === workspaceId);
  }

  createProject({ userId, workspaceId, name }, persist = true) {
    this.assertMember(userId, workspaceId);
    const projectName = String(name ?? "").trim();
    if (!projectName) throw httpError(400, "Название проекта обязательно");
    const project = {
      id: this.issueId("project"),
      workspaceId,
      name: projectName,
      createdAt: nowIso()
    };
    this.db.projects.push(project);
    if (persist) this.save();
    return project;
  }

  listTasks(userId, { workspaceId, projectId, search = "", tag = "", mode = "active" }) {
    this.assertMember(userId, workspaceId);
    const projectIds = this.db.projects.filter((project) => project.workspaceId === workspaceId).map((project) => project.id);
    const normalizedSearch = String(search).trim().toLowerCase();
    return this.db.tasks
      .filter((task) => projectIds.includes(task.projectId))
      .filter((task) => !projectId || task.projectId === projectId)
      .filter((task) => (mode === "deferred" ? task.deferred : !task.deferred))
      .filter((task) => !tag || task.tag === tag)
      .filter((task) => {
        if (!normalizedSearch) return true;
        return `${task.title} ${task.description} ${task.tag}`.toLowerCase().includes(normalizedSearch);
      })
      .map((task) => this.hydrateTask(task));
  }

  createTask(userId, workspaceId, payload) {
    this.assertMember(userId, workspaceId);
    const project = this.assertProjectInWorkspace(payload.projectId, workspaceId);
    const task = {
      id: this.issueId("task"),
      projectId: project.id,
      title: requireText(payload.title, "Название задачи обязательно"),
      description: String(payload.description ?? "").trim(),
      tag: payload.tag || "frontend",
      priority: normalizeChoice(payload.priority, ["low", "medium", "high"], "medium"),
      assigneeId: normalizeNullableId(payload.assigneeId),
      dueDate: payload.dueDate || "",
      status: normalizeChoice(payload.status, ["todo", "inprog", "done"], "todo"),
      deferred: false,
      deferredReason: "",
      deferredUntil: "",
      checklist: normalizeChecklist(payload.checklist, this),
      materials: normalizeMaterials(payload.materials, this),
      createdBy: userId,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.db.tasks.push(task);
    this.addHistory(task.id, userId, "created", `Создал задачу в проекте «${project.name}»`);
    this.save();
    return this.hydrateTask(task);
  }

  updateTask(userId, workspaceId, taskId, payload) {
    const task = this.assertTaskAccess(userId, workspaceId, taskId);
    const before = { ...task };
    const nextChecklist = normalizeChecklist(payload.checklist, this);
    const nextStatus = normalizeChoice(payload.status, ["todo", "inprog", "done"], "todo");
    if (nextStatus === "done" && nextChecklist.some((item) => !item.done)) {
      throw httpError(400, "Нельзя закрыть задачу, пока чеклист не выполнен");
    }
    task.title = requireText(payload.title, "Название задачи обязательно");
    task.description = String(payload.description ?? "").trim();
    task.tag = payload.tag || "frontend";
    task.priority = normalizeChoice(payload.priority, ["low", "medium", "high"], "medium");
    task.assigneeId = normalizeNullableId(payload.assigneeId);
    task.dueDate = payload.dueDate || "";
    task.status = nextStatus;
    task.checklist = nextChecklist;
    task.materials = normalizeMaterials(payload.materials, this);
    task.updatedAt = nowIso();

    this.addHistory(task.id, userId, "updated", describeTaskUpdate(before, task));
    this.save();
    return this.hydrateTask(task);
  }

  moveTask(userId, workspaceId, taskId, status) {
    const task = this.assertTaskAccess(userId, workspaceId, taskId);
    const nextStatus = normalizeChoice(status, ["todo", "inprog", "done"], task.status);
    if (nextStatus === "done" && task.checklist.some((item) => !item.done)) {
      throw httpError(400, "Нельзя закрыть задачу, пока чеклист не выполнен");
    }
    const oldTitle = STATUS_TITLES[task.status] ?? task.status;
    const newTitle = STATUS_TITLES[nextStatus] ?? nextStatus;
    task.status = nextStatus;
    task.updatedAt = nowIso();
    this.addHistory(task.id, userId, "moved", `Переместил из «${oldTitle}» в «${newTitle}»`);
    this.save();
    return this.hydrateTask(task);
  }

  deferTask(userId, workspaceId, taskId, { reason, until }) {
    const task = this.assertTaskAccess(userId, workspaceId, taskId);
    task.deferred = true;
    task.deferredReason = requireText(reason, "Причина отложения обязательна");
    task.deferredUntil = until || "";
    task.updatedAt = nowIso();
    this.addHistory(task.id, userId, "deferred", `Отложил задачу: ${task.deferredReason}`);
    this.save();
    return this.hydrateTask(task);
  }

  restoreTask(userId, workspaceId, taskId) {
    const task = this.assertTaskAccess(userId, workspaceId, taskId);
    task.deferred = false;
    task.deferredReason = "";
    task.deferredUntil = "";
    task.updatedAt = nowIso();
    this.addHistory(task.id, userId, "restored", "Вернул задачу на доску");
    this.save();
    return this.hydrateTask(task);
  }

  deleteTask(userId, workspaceId, taskId) {
    this.assertTaskAccess(userId, workspaceId, taskId);
    this.db.tasks = this.db.tasks.filter((task) => task.id !== taskId);
    this.db.comments = this.db.comments.filter((comment) => comment.taskId !== taskId);
    this.db.history = this.db.history.filter((entry) => entry.taskId !== taskId);
    this.save();
  }

  addComment(userId, workspaceId, taskId, text) {
    this.assertTaskAccess(userId, workspaceId, taskId);
    const comment = {
      id: this.issueId("comment"),
      taskId,
      userId,
      text: requireText(text, "Комментарий не может быть пустым"),
      createdAt: nowIso()
    };
    this.db.comments.push(comment);
    this.addHistory(taskId, userId, "commented", "Добавил комментарий");
    this.save();
    return this.hydrateComment(comment);
  }

  toggleChecklist(userId, workspaceId, taskId, itemId) {
    const task = this.assertTaskAccess(userId, workspaceId, taskId);
    const item = task.checklist.find((entry) => entry.id === itemId);
    if (!item) throw httpError(404, "Пункт чеклиста не найден");
    item.done = !item.done;
    task.updatedAt = nowIso();
    this.addHistory(task.id, userId, "checklist", `${item.done ? "Выполнил" : "Вернул"} пункт «${item.text}»`);
    this.save();
    return this.hydrateTask(task);
  }

  addHistory(taskId, userId, action, details) {
    this.db.history.push({
      id: this.issueId("history"),
      taskId,
      userId,
      action,
      details,
      createdAt: nowIso()
    });
  }

  hydrateTask(task) {
    return {
      ...task,
      assignee: task.assigneeId ? publicUser(this.db.users.find((user) => user.id === task.assigneeId)) : null,
      createdByUser: publicUser(this.db.users.find((user) => user.id === task.createdBy)),
      comments: this.db.comments.filter((comment) => comment.taskId === task.id).map((comment) => this.hydrateComment(comment)),
      history: this.db.history.filter((entry) => entry.taskId === task.id).map((entry) => this.hydrateHistory(entry))
    };
  }

  hydrateComment(comment) {
    return {
      ...comment,
      user: publicUser(this.db.users.find((user) => user.id === comment.userId))
    };
  }

  hydrateHistory(entry) {
    return {
      ...entry,
      user: publicUser(this.db.users.find((user) => user.id === entry.userId))
    };
  }

  assertOwner(userId, workspaceId) {
    const membership = this.db.members.find((member) => member.workspaceId === workspaceId && member.userId === userId);
    if (!membership) throw httpError(403, "Нет доступа к workspace");
    if (membership.role !== "owner") throw httpError(403, "Добавлять участников может только владелец");
  }

  assertMember(userId, workspaceId) {
    const membership = this.db.members.find((member) => member.workspaceId === workspaceId && member.userId === userId);
    if (!membership) throw httpError(403, "Нет доступа к workspace");
    return membership;
  }

  assertProjectInWorkspace(projectId, workspaceId) {
    const id = Number(projectId);
    const project = this.db.projects.find((item) => item.id === id && item.workspaceId === workspaceId);
    if (!project) throw httpError(404, "Проект не найден");
    return project;
  }

  assertTaskAccess(userId, workspaceId, taskId) {
    this.assertMember(userId, workspaceId);
    const projectIds = this.db.projects.filter((project) => project.workspaceId === workspaceId).map((project) => project.id);
    const task = this.db.tasks.find((item) => item.id === Number(taskId) && projectIds.includes(item.projectId));
    if (!task) throw httpError(404, "Задача не найдена");
    return task;
  }
}

export function createMemoryStore() {
  const store = new JsonStore(":memory:");
  store.save = () => {};
  return store;
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    initials: getInitials(user.name || user.login)
  };
}

function loadDb(filePath) {
  if (filePath !== ":memory:" && existsSync(filePath)) {
    return mergeDb(JSON.parse(readFileSync(filePath, "utf8")));
  }
  return structuredClone(DEFAULT_DB);
}

function mergeDb(db) {
  return {
    ...structuredClone(DEFAULT_DB),
    ...db,
    nextIds: { ...DEFAULT_DB.nextIds, ...(db.nextIds ?? {}) }
  };
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored ?? "").split(":");
  if (!salt || !hash) return false;
  const calculated = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === calculated.length && timingSafeEqual(expected, calculated);
}

export function normalizeLogin(login) {
  return String(login ?? "").trim().toLowerCase();
}

export function normalizeChoice(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

export function normalizeNullableId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function requireText(value, message) {
  const text = String(value ?? "").trim();
  if (!text) throw httpError(400, message);
  return text;
}

export function normalizeChecklist(items, store) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item) => ({
      id: Number(item.id) || store.issueId("checklist"),
      text: String(item.text ?? "").trim(),
      done: Boolean(item.done)
    }))
    .filter((item) => item.text)
    .slice(0, 12);
}

export function normalizeMaterials(items, store) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item) => ({
      id: Number(item.id) || store.issueId("material"),
      name: String(item.name ?? "").trim(),
      url: String(item.url ?? "").trim(),
      fileName: String(item.fileName ?? "").trim(),
      size: Number(item.size) > 0 ? Number(item.size) : null,
      mimeType: String(item.mimeType ?? "").trim()
    }))
    .filter((item) => item.name || item.url)
    .slice(0, 8);
}

export function describeTaskUpdate(before, after) {
  const changes = [];
  if (before.title !== after.title) changes.push("название");
  if (before.priority !== after.priority) changes.push("приоритет");
  if (before.assigneeId !== after.assigneeId) changes.push("исполнитель");
  if (before.dueDate !== after.dueDate) changes.push("срок");
  if (before.status !== after.status) changes.push("статус");
  if (before.tag !== after.tag) changes.push("тег");
  if (changes.length === 0) return "Обновил карточку";
  return `Изменил: ${changes.join(", ")}`;
}

function getInitials(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

export function nowIso() {
  return new Date().toISOString();
}
