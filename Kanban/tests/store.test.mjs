import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/server/store.js";

function setupStore() {
  const store = createMemoryStore();
  const owner = store.register({ login: "owner", password: "secret1", name: "Ольга Owner" });
  const member = store.register({ login: "member", password: "secret1", name: "Миша Member" });
  const workspace = store.listWorkspaces(owner.id)[0];
  const project = store.listProjects(owner.id, workspace.id)[0];
  return { store, owner, member, workspace, project };
}

test("регистрация создает пользователя, workspace и проект по умолчанию", () => {
  const { store, owner, workspace, project } = setupStore();

  assert.equal(owner.login, "owner");
  assert.equal(workspace.name, "Мой workspace");
  assert.equal(project.name, "Канбан");
  assert.equal(store.listMembers(owner.id, workspace.id)[0].role, "owner");
});

test("owner добавляет участника workspace по логину", () => {
  const { store, owner, member, workspace } = setupStore();

  const added = store.addWorkspaceMember({ userId: owner.id, workspaceId: workspace.id, login: "member" });
  const members = store.listMembers(owner.id, workspace.id);
  const memberWorkspaces = store.listWorkspaces(member.id);

  assert.equal(added.login, "member");
  assert.equal(members.length, 2);
  assert.equal(memberWorkspaces.some((item) => item.id === workspace.id), true);
});

test("задача хранит приоритет, исполнителя, чеклист, материалы, комментарии и историю", () => {
  const { store, owner, member, workspace, project } = setupStore();
  store.addWorkspaceMember({ userId: owner.id, workspaceId: workspace.id, login: member.login });

  const task = store.createTask(owner.id, workspace.id, {
    projectId: project.id,
    title: "Подготовить защиту",
    description: "Собрать аргументы по функционалу",
    tag: "qa",
    priority: "high",
    assigneeId: member.id,
    dueDate: "2026-06-20",
    checklist: [{ text: "Сценарии" }, { text: "Скриншоты" }],
    materials: [{ name: "ТЗ", url: "https://example.com" }]
  });
  const comment = store.addComment(member.id, workspace.id, task.id, "Беру сценарии на себя");
  const updated = store.toggleChecklist(owner.id, workspace.id, task.id, task.checklist[0].id);

  assert.equal(task.priority, "high");
  assert.equal(task.assignee.login, "member");
  assert.equal(task.materials[0].name, "ТЗ");
  assert.equal(comment.user.login, "member");
  assert.equal(updated.checklist[0].done, true);
  assert.ok(updated.history.some((entry) => entry.action === "created"));
  assert.ok(updated.history.some((entry) => entry.action === "checklist"));
});

test("материалы задачи хранят метаданные загруженного файла", () => {
  const { store, owner, workspace, project } = setupStore();

  const task = store.createTask(owner.id, workspace.id, {
    projectId: project.id,
    title: "Загрузка файла",
    materials: [{
      name: "brief.pdf",
      url: "/uploads/brief.pdf",
      fileName: "brief.pdf",
      size: 2048,
      mimeType: "application/pdf"
    }]
  });

  assert.equal(task.materials[0].fileName, "brief.pdf");
  assert.equal(task.materials[0].size, 2048);
  assert.equal(task.materials[0].mimeType, "application/pdf");
});

test("нельзя закрыть задачу с невыполненным чеклистом", () => {
  const { store, owner, workspace, project } = setupStore();
  const task = store.createTask(owner.id, workspace.id, {
    projectId: project.id,
    title: "Релиз",
    checklist: [{ text: "Проверка" }]
  });

  assert.throws(
    () => store.moveTask(owner.id, workspace.id, task.id, "done"),
    /чеклист/
  );
});

test("нельзя обойти чеклист через редактирование статуса", () => {
  const { store, owner, workspace, project } = setupStore();
  const task = store.createTask(owner.id, workspace.id, {
    projectId: project.id,
    title: "Релиз",
    tag: "qa",
    status: "todo",
    checklist: [{ text: "Проверка" }]
  });

  assert.throws(
    () => store.updateTask(owner.id, workspace.id, task.id, {
      ...task,
      workspaceId: workspace.id,
      projectId: project.id,
      status: "done"
    }),
    /чеклист/
  );
});

test("отложенная задача исчезает из активной доски и видна в режиме отложено", () => {
  const { store, owner, workspace, project } = setupStore();
  const task = store.createTask(owner.id, workspace.id, {
    projectId: project.id,
    title: "Ждем договор"
  });

  store.deferTask(owner.id, workspace.id, task.id, { reason: "Нужен ответ клиента", until: "2026-06-25" });

  assert.equal(store.listTasks(owner.id, { workspaceId: workspace.id, projectId: project.id, mode: "active" }).length, 0);
  assert.equal(store.listTasks(owner.id, { workspaceId: workspace.id, projectId: project.id, mode: "deferred" })[0].deferredReason, "Нужен ответ клиента");
});
