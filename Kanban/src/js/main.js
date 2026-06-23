const COLUMNS = [
  { id: "todo", name: "К выполнению", dot: "dot-todo" },
  { id: "inprog", name: "В работе", dot: "dot-inprog" },
  { id: "done", name: "Готово", dot: "dot-done" }
];

const TAGS = ["frontend", "backend", "design", "devops", "qa"];
const PRIORITIES = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий"
};

const state = {
  user: null,
  workspaces: [],
  workspaceId: Number(localStorage.getItem("workspaceId")) || null,
  members: [],
  projects: [],
  projectId: Number(localStorage.getItem("projectId")) || null,
  tasks: [],
  selectedId: null,
  mode: "active",
  search: "",
  tag: "",
  authMode: "login",
  taskModal: false,
  editingId: null,
  deferModal: false,
  deferTaskId: null,
  loading: true,
  draggedId: null
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let appEventsBound = false;

boot();

async function boot() {
  try {
    const session = await api("/api/session");
    state.user = session.user;
    if (state.user) await loadWorkspaceData();
  } catch (error) {
    notify(error.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

async function loadWorkspaceData() {
  const workspaceResponse = await api("/api/workspaces");
  state.workspaces = workspaceResponse.workspaces;
  if (!state.workspaces.some((workspace) => workspace.id === state.workspaceId)) {
    state.workspaceId = state.workspaces[0]?.id ?? null;
  }
  if (!state.workspaceId) return;
  localStorage.setItem("workspaceId", String(state.workspaceId));

  const [membersResponse, projectsResponse] = await Promise.all([
    api(`/api/workspaces/${state.workspaceId}/members`),
    api(`/api/projects?workspaceId=${state.workspaceId}`)
  ]);
  state.members = membersResponse.members;
  state.projects = projectsResponse.projects;
  if (!state.projects.some((project) => project.id === state.projectId)) {
    state.projectId = state.projects[0]?.id ?? null;
  }
  if (state.projectId) localStorage.setItem("projectId", String(state.projectId));
  await loadTasks();
}

async function loadTasks() {
  if (!state.workspaceId) {
    state.tasks = [];
    return;
  }
  const params = new URLSearchParams({
    workspaceId: String(state.workspaceId),
    mode: state.mode,
    search: state.search,
    tag: state.tag
  });
  if (state.projectId) params.set("projectId", String(state.projectId));
  const response = await api(`/api/tasks?${params.toString()}`);
  state.tasks = response.tasks;
  if (!state.tasks.some((task) => task.id === state.selectedId)) {
    state.selectedId = state.tasks[0]?.id ?? null;
  }
}

function render() {
  if (state.loading) {
    app.innerHTML = `<div class="kb-loader">Загрузка…</div>`;
    return;
  }
  if (!state.user) {
    app.innerHTML = authMarkup();
    bindAuthForms();
    return;
  }

  app.innerHTML = appMarkup();
  bindAppEvents();
}

function authMarkup() {
  const isRegister = state.authMode === "register";
  return `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="kb-logo auth-logo">
          <div class="kb-logo-mark">${logoSvg()}</div>
          <div>
            <div class="kb-logo-text">Innotech</div>
            <div class="kb-logo-sub">Workspace Kanban</div>
          </div>
        </div>
        <h1>${isRegister ? "Создать аккаунт" : "Войти в workspace"}</h1>
        <p>Зарегистрируйтесь по логину и паролю. По логину вас смогут добавить в рабочее пространство.</p>
        <form id="authForm" class="auth-form">
          ${isRegister ? `<label>Имя<input name="name" placeholder="Например: Ника Галиахметова"></label>` : ""}
          <label>Логин<input name="login" required minlength="3" autocomplete="username" placeholder="nika"></label>
          <label>Пароль<input name="password" required minlength="6" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}"></label>
          <button class="kb-add-btn auth-submit" type="submit">${isRegister ? "Зарегистрироваться" : "Войти"}</button>
        </form>
        <button class="link-button" type="button" id="toggleAuth">
          ${isRegister ? "Уже есть аккаунт" : "Нет аккаунта, зарегистрироваться"}
        </button>
      </section>
    </main>
  `;
}

function appMarkup() {
  const selected = state.tasks.find((task) => task.id === state.selectedId);
  return `
    <header class="kb-header">
      <div class="kb-logo">
        <div class="kb-logo-mark">${logoSvg()}</div>
        <div>
          <div class="kb-logo-text">Innotech</div>
          <div class="kb-logo-sub">Командная доска задач</div>
        </div>
      </div>
      <div class="kb-header-actions">
        <span class="user-chip">${escapeHtml(state.user.name)} · @${escapeHtml(state.user.login)}</span>
        <button class="kb-ghost-btn" data-action="logout" type="button">Выйти</button>
      </div>
    </header>

    <section class="workspace-bar">
      <label>Workspace
        <select id="workspaceSelect">
          ${state.workspaces.map((workspace) => `<option value="${workspace.id}" ${workspace.id === state.workspaceId ? "selected" : ""}>${escapeHtml(workspace.name)}</option>`).join("")}
        </select>
      </label>
      <form class="inline-form" data-form="workspace">
        <input name="name" placeholder="Новый workspace">
        <button type="submit">Создать</button>
      </form>
      <form class="inline-form" data-form="member">
        <input name="login" placeholder="Добавить по логину">
        <button type="submit">Добавить</button>
      </form>
      <div class="member-row">${state.members.map(memberMarkup).join("")}</div>
    </section>

    <section class="project-bar">
      <label>Проект
        <select id="projectSelect">
          ${state.projects.map((project) => `<option value="${project.id}" ${project.id === state.projectId ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("")}
        </select>
      </label>
      <form class="inline-form" data-form="project">
        <input name="name" placeholder="Новый проект">
        <button type="submit">Создать проект</button>
      </form>
    </section>

    <div class="kb-toolbar">
      <input class="kb-search" id="searchInput" type="text" placeholder="Поиск задач…" value="${escapeHtml(state.search)}">
      <select class="kb-filter" id="tagFilter">
        <option value="">Все теги</option>
        ${TAGS.map((tag) => `<option value="${tag}" ${tag === state.tag ? "selected" : ""}>${tagLabel(tag)}</option>`).join("")}
      </select>
      <div class="mode-switch" role="group" aria-label="Режим задач">
        <button class="${state.mode === "active" ? "active" : ""}" data-action="mode" data-mode="active" type="button">Активные</button>
        <button class="${state.mode === "deferred" ? "active" : ""}" data-action="mode" data-mode="deferred" type="button">Отложено</button>
      </div>
      <button class="kb-add-btn" data-action="open-task" type="button">+ Добавить задачу</button>
      <div class="kb-counters">${counterMarkup()}</div>
    </div>

    <main class="workspace-layout">
      <section class="kb-board" id="board">
        ${COLUMNS.map(columnMarkup).join("")}
      </section>
      <aside class="kb-details" id="detailsPanel">
        ${selected ? detailsMarkup(selected) : emptyDetailsMarkup()}
      </aside>
    </main>

    ${state.taskModal ? taskModalMarkup() : ""}
    ${state.deferModal ? deferModalMarkup() : ""}
  `;
}

function columnMarkup(column) {
  const columnTasks = state.tasks.filter((task) => task.status === column.id);
  return `
    <div class="kb-col">
      <div class="kb-col-header">
        <div class="kb-col-title-row">
          <div class="kb-col-dot ${column.dot}"></div>
          <span class="kb-col-name">${column.name}</span>
          <span class="kb-col-count">${columnTasks.length}</span>
        </div>
        <button class="kb-col-plus" data-action="open-task" data-status="${column.id}" type="button">+</button>
      </div>
      <div class="kb-col-body" data-drop-status="${column.id}">
        ${columnTasks.length ? columnTasks.map(cardMarkup).join("") : `<div class="kb-col-empty">Нет задач</div>`}
      </div>
    </div>
  `;
}

function cardMarkup(task) {
  const dateClass = dateState(task.dueDate);
  const checklistDone = task.checklist.filter((item) => item.done).length;
  const checklistTotal = task.checklist.length;
  return `
    <article class="kb-card ${task.id === state.selectedId ? "selected" : ""} priority-${task.priority}" draggable="true" data-task-id="${task.id}">
      <div class="card-topline">
        <span class="kb-card-tag tag-${task.tag}">${tagLabel(task.tag)}</span>
        <span class="priority-pill">${PRIORITIES[task.priority]}</span>
      </div>
      <div class="kb-card-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="kb-card-desc">${escapeHtml(task.description)}</div>` : ""}
      ${task.deferred ? `<div class="deferred-note">Отложено: ${escapeHtml(task.deferredReason)}</div>` : ""}
      <div class="kb-card-footer">
        <div class="kb-card-meta">
          <div class="kb-card-avatar">${escapeHtml(task.assignee?.initials || "?")}</div>
          <span class="kb-card-date ${dateClass}">${formatDate(task.dueDate) || "без срока"}</span>
          ${checklistTotal ? `<span class="mini-stat">${checklistDone}/${checklistTotal}</span>` : ""}
        </div>
        <div class="kb-card-actions">
          <button class="kb-card-btn" data-action="edit-task" data-task-id="${task.id}" type="button">Изм.</button>
          <button class="kb-card-btn del" data-action="delete-task" data-task-id="${task.id}" type="button">Удал.</button>
        </div>
      </div>
    </article>
  `;
}

function detailsMarkup(task) {
  const canRestore = task.deferred;
  return `
    <div class="details-head">
      <span class="kb-card-tag tag-${task.tag}">${tagLabel(task.tag)}</span>
      <h2>${escapeHtml(task.title)}</h2>
      <p>${escapeHtml(task.description || "Описание не заполнено.")}</p>
    </div>
    <div class="details-grid">
      <div><span>Исполнитель</span><strong>${escapeHtml(task.assignee?.name || "Не назначен")}</strong></div>
      <div><span>Приоритет</span><strong>${PRIORITIES[task.priority]}</strong></div>
      <div><span>Срок</span><strong>${formatDate(task.dueDate) || "Без срока"}</strong></div>
      <div><span>Статус</span><strong>${columnName(task.status)}</strong></div>
    </div>
    <div class="details-actions">
      <button data-action="edit-task" data-task-id="${task.id}" type="button">Редактировать</button>
      ${canRestore
        ? `<button data-action="restore-task" data-task-id="${task.id}" type="button">Вернуть на доску</button>`
        : `<button data-action="open-defer" data-task-id="${task.id}" type="button">Отложить</button>`}
    </div>

    <section class="detail-section">
      <h3>Чеклист</h3>
      ${task.checklist.length ? task.checklist.map((item) => `
        <label class="check-item">
          <input type="checkbox" data-action="toggle-check" data-task-id="${task.id}" data-item-id="${item.id}" ${item.done ? "checked" : ""}>
          <span>${escapeHtml(item.text)}</span>
        </label>
      `).join("") : `<p class="muted">Пункты не добавлены.</p>`}
    </section>

    <section class="detail-section">
      <h3>Материалы</h3>
      ${task.materials.length ? task.materials.map((item) => `
        <a class="material-link" href="${escapeAttr(item.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(item.name || item.url)}</a>
      `).join("") : `<p class="muted">Файлы или ссылки не добавлены.</p>`}
    </section>

    <section class="detail-section">
      <h3>Комментарии</h3>
      <div class="comment-list">
        ${task.comments.length ? task.comments.map((comment) => `
          <article class="comment-item">
            <strong>${escapeHtml(comment.user?.name || "Пользователь")}</strong>
            <span>${formatDateTime(comment.createdAt)}</span>
            <p>${escapeHtml(comment.text)}</p>
          </article>
        `).join("") : `<p class="muted">Комментариев пока нет.</p>`}
      </div>
      <form class="comment-form" data-form="comment" data-task-id="${task.id}">
        <textarea name="text" rows="2" placeholder="Добавить комментарий"></textarea>
        <button type="submit">Отправить</button>
      </form>
    </section>

    <section class="detail-section">
      <h3>История</h3>
      <div class="history-list">
        ${task.history.length ? [...task.history].reverse().map((entry) => `
          <article class="history-item">
            <span>${formatDateTime(entry.createdAt)}</span>
            <strong>${escapeHtml(entry.user?.name || "Система")}</strong>
            <p>${escapeHtml(entry.details)}</p>
          </article>
        `).join("") : `<p class="muted">История появится после изменений.</p>`}
      </div>
    </section>
  `;
}

function emptyDetailsMarkup() {
  return `
    <div class="empty-details">
      <h2>Выберите задачу</h2>
      <p>Справа появятся комментарии, история, чеклист и материалы.</p>
    </div>
  `;
}

function taskModalMarkup() {
  const task = state.tasks.find((item) => item.id === state.editingId);
  const isEdit = Boolean(task);
  return `
    <div class="kb-overlay open">
      <form class="kb-modal task-modal" data-form="task">
        <div class="kb-modal-title">${isEdit ? "Редактировать задачу" : "Добавить задачу"}</div>
        <label>Название *<input name="title" required maxlength="120" value="${escapeAttr(task?.title || "")}" placeholder="Название задачи"></label>
        <label>Описание<textarea name="description" rows="3" maxlength="800" placeholder="Что должно быть сделано?">${escapeHtml(task?.description || "")}</textarea></label>
        <div class="form-grid">
          <label>Тег
            <select name="tag">${TAGS.map((tag) => `<option value="${tag}" ${task?.tag === tag ? "selected" : ""}>${tagLabel(tag)}</option>`).join("")}</select>
          </label>
          <label>Приоритет
            <select name="priority">
              ${Object.entries(PRIORITIES).map(([value, label]) => `<option value="${value}" ${(task?.priority || "medium") === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label>Исполнитель
            <select name="assigneeId">
              <option value="">Не назначен</option>
              ${state.members.map((member) => `<option value="${member.id}" ${task?.assigneeId === member.id ? "selected" : ""}>${escapeHtml(member.name)} (@${escapeHtml(member.login)})</option>`).join("")}
            </select>
          </label>
          <label>Срок<input name="dueDate" type="date" value="${escapeAttr(task?.dueDate || "")}"></label>
          <label>Колонка
            <select name="status">${COLUMNS.map((column) => `<option value="${column.id}" ${(task?.status || task?.defaultStatus || "todo") === column.id ? "selected" : ""}>${column.name}</option>`).join("")}</select>
          </label>
        </div>
        <label>Чеклист<textarea name="checklist" rows="4" placeholder="Один пункт на строку">${escapeHtml((task?.checklist || []).map((item) => `${item.done ? "[x] " : ""}${item.text}`).join("\n"))}</textarea></label>
        <label>Файлы и ссылки<textarea name="materials" rows="3" placeholder="Макет | https://...\nТЗ | https://...">${escapeHtml((task?.materials || []).map((item) => `${item.name}${item.url ? ` | ${item.url}` : ""}`).join("\n"))}</textarea></label>
        <label>Загрузить файлы<input name="files" type="file" multiple></label>
        <div class="kb-modal-actions">
          <button class="kb-modal-cancel" data-action="close-modal" type="button">Отмена</button>
          <button class="kb-modal-save" type="submit">${isEdit ? "Сохранить" : "Добавить"}</button>
        </div>
      </form>
    </div>
  `;
}

function deferModalMarkup() {
  return `
    <div class="kb-overlay open">
      <form class="kb-modal" data-form="defer">
        <div class="kb-modal-title">Отложить задачу</div>
        <label>Причина *<textarea name="reason" required rows="3" placeholder="Например: ждём ответ клиента"></textarea></label>
        <label>Вернуть после<input name="until" type="date"></label>
        <div class="kb-modal-actions">
          <button class="kb-modal-cancel" data-action="close-modal" type="button">Отмена</button>
          <button class="kb-modal-save" type="submit">Отложить</button>
        </div>
      </form>
    </div>
  `;
}

function bindAuthForms() {
  document.querySelector("#toggleAuth").addEventListener("click", () => {
    state.authMode = state.authMode === "login" ? "register" : "login";
    render();
  });
  document.querySelector("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const endpoint = state.authMode === "register" ? "/api/register" : "/api/login";
      const response = await api(endpoint, { method: "POST", body: data });
      state.user = response.user;
      await loadWorkspaceData();
      render();
      notify(state.authMode === "register" ? "Аккаунт создан" : "Вход выполнен");
    } catch (error) {
      notify(error.message, true);
    }
  });
}

function bindAppEvents() {
  document.querySelector("#workspaceSelect")?.addEventListener("change", async (event) => {
    state.workspaceId = Number(event.target.value);
    state.projectId = null;
    state.selectedId = null;
    await loadWorkspaceData();
    render();
  });
  document.querySelector("#projectSelect")?.addEventListener("change", async (event) => {
    state.projectId = Number(event.target.value);
    localStorage.setItem("projectId", String(state.projectId));
    state.selectedId = null;
    await loadTasks();
    render();
  });
  document.querySelector("#searchInput")?.addEventListener("input", debounce(async (event) => {
    state.search = event.target.value;
    await loadTasks();
    render();
  }, 220));
  document.querySelector("#tagFilter")?.addEventListener("change", async (event) => {
    state.tag = event.target.value;
    await loadTasks();
    render();
  });

  if (!appEventsBound) {
    app.addEventListener("click", handleClick);
    app.addEventListener("submit", handleSubmit);
    app.addEventListener("change", handleChange);
    appEventsBound = true;
  }
  bindDragAndDrop();
}

async function handleClick(event) {
  const actionEl = event.target.closest("[data-action]");
  const card = event.target.closest("[data-task-id]");
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === "toggle-check") return;
    const taskId = Number(actionEl.dataset.taskId);
    event.preventDefault();
    await runAction(action, actionEl, taskId);
    return;
  }
  if (card && !event.target.closest("button,input,textarea,a")) {
    state.selectedId = Number(card.dataset.taskId);
    render();
  }
}

async function runAction(action, element, taskId) {
  try {
    if (action === "logout") {
      await api("/api/logout", { method: "POST" });
      state.user = null;
      state.tasks = [];
      render();
      return;
    }
    if (action === "mode") {
      state.mode = element.dataset.mode;
      state.selectedId = null;
      await loadTasks();
      render();
      return;
    }
    if (action === "open-task") {
      state.editingId = null;
      state.taskModal = true;
      render();
      const status = element.dataset.status;
      if (status) document.querySelector("[name='status']").value = status;
      return;
    }
    if (action === "edit-task") {
      state.editingId = taskId;
      state.taskModal = true;
      render();
      return;
    }
    if (action === "delete-task") {
      if (!confirm("Удалить задачу?")) return;
      await api(`/api/tasks/${taskId}?workspaceId=${state.workspaceId}`, { method: "DELETE" });
      state.selectedId = null;
      await loadTasks();
      render();
      notify("Задача удалена");
      return;
    }
    if (action === "open-defer") {
      state.deferTaskId = taskId;
      state.deferModal = true;
      render();
      return;
    }
    if (action === "restore-task") {
      await api(`/api/tasks/${taskId}/restore`, { method: "POST", body: { workspaceId: state.workspaceId } });
      await loadTasks();
      render();
      notify("Задача возвращена на доску");
      return;
    }
    if (action === "close-modal") {
      closeModalState();
      render();
    }
  } catch (error) {
    notify(error.message, true);
  }
}

async function handleSubmit(event) {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  try {
    const formType = form.dataset.form;
    const data = Object.fromEntries(new FormData(form).entries());
    if (formType === "workspace") {
      const response = await api("/api/workspaces", { method: "POST", body: data });
      state.workspaceId = response.workspace.id;
      await loadWorkspaceData();
      render();
      notify("Workspace создан");
    }
    if (formType === "member") {
      await api(`/api/workspaces/${state.workspaceId}/members`, { method: "POST", body: data });
      await loadWorkspaceData();
      render();
      notify("Участник добавлен");
    }
    if (formType === "project") {
      const response = await api("/api/projects", { method: "POST", body: { workspaceId: state.workspaceId, name: data.name } });
      state.projectId = response.project.id;
      await loadWorkspaceData();
      render();
      notify("Проект создан");
    }
    if (formType === "task") {
      await saveTask(data, form);
    }
    if (formType === "comment") {
      await api(`/api/tasks/${form.dataset.taskId}/comments`, { method: "POST", body: { workspaceId: state.workspaceId, text: data.text } });
      await loadTasks();
      render();
      notify("Комментарий добавлен");
    }
    if (formType === "defer") {
      await api(`/api/tasks/${state.deferTaskId}/defer`, { method: "POST", body: { workspaceId: state.workspaceId, reason: data.reason, until: data.until } });
      closeModalState();
      await loadTasks();
      render();
      notify("Задача отложена");
    }
  } catch (error) {
    notify(error.message, true);
  }
}

async function handleChange(event) {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  if (actionEl.dataset.action === "toggle-check") {
    try {
      await api(`/api/tasks/${actionEl.dataset.taskId}/checklist/${actionEl.dataset.itemId}`, {
        method: "POST",
        body: { workspaceId: state.workspaceId }
      });
      await loadTasks();
      render();
    } catch (error) {
      notify(error.message, true);
    }
  }
}

async function saveTask(data, form) {
  const original = state.tasks.find((task) => task.id === state.editingId);
  const uploadedMaterials = await uploadTaskFiles(form);
  const payload = {
    workspaceId: state.workspaceId,
    projectId: state.projectId,
    title: data.title,
    description: data.description,
    tag: data.tag,
    priority: data.priority,
    assigneeId: data.assigneeId || null,
    dueDate: data.dueDate,
    status: data.status,
    checklist: parseChecklist(data.checklist, original?.checklist || []),
    materials: [...parseMaterials(data.materials, original?.materials || []), ...uploadedMaterials]
  };
  if (original) {
    await api(`/api/tasks/${original.id}`, { method: "PUT", body: payload });
    notify("Задача обновлена");
  } else {
    const response = await api("/api/tasks", { method: "POST", body: payload });
    state.selectedId = response.task.id;
    notify("Задача создана");
  }
  closeModalState();
  await loadTasks();
  render();
}

async function uploadTaskFiles(form) {
  const input = form.querySelector("input[name='files']");
  const files = [...(input?.files || [])];
  const uploaded = [];
  for (const file of files) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить файл");
    uploaded.push(data.file);
  }
  return uploaded;
}

function bindDragAndDrop() {
  document.querySelectorAll(".kb-card").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      state.draggedId = Number(card.dataset.taskId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(state.draggedId));
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.querySelectorAll(".kb-col-body").forEach((body) => body.classList.remove("drag-over"));
    });
  });
  document.querySelectorAll("[data-drop-status]").forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      zone.classList.remove("drag-over");
      const taskId = Number(event.dataTransfer.getData("text/plain") || state.draggedId);
      if (!taskId) return;
      try {
        await api(`/api/tasks/${taskId}/move`, { method: "POST", body: { workspaceId: state.workspaceId, status: zone.dataset.dropStatus } });
        await loadTasks();
        render();
        notify("Задача перемещена");
      } catch (error) {
        notify(error.message, true);
      }
    });
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function closeModalState() {
  state.taskModal = false;
  state.editingId = null;
  state.deferModal = false;
  state.deferTaskId = null;
}

function memberMarkup(member) {
  return `<span class="member-chip" title="@${escapeAttr(member.login)}">${escapeHtml(member.initials)}<em>${member.role === "owner" ? "owner" : "member"}</em></span>`;
}

function counterMarkup() {
  const active = state.tasks.length;
  const overdue = state.tasks.filter((task) => dateState(task.dueDate) === "overdue").length;
  const blocked = state.tasks.filter((task) => task.deferred).length;
  return `
    <div class="kb-counter"><span class="kb-counter-label">Задач:</span> <span class="kb-counter-value">${active}</span></div>
    <div class="kb-counter"><span class="kb-counter-label">Просрочено:</span> <span class="kb-counter-value">${overdue}</span></div>
    <div class="kb-counter"><span class="kb-counter-label">Отложено:</span> <span class="kb-counter-value">${blocked}</span></div>
  `;
}

function parseChecklist(value, previous) {
  const previousByText = new Map(previous.map((item) => [item.text, item]));
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const done = /^\[x\]\s*/i.test(line);
      const text = line.replace(/^\[(x| )\]\s*/i, "").trim();
      const old = previousByText.get(text);
      return { id: old?.id, text, done: done || Boolean(old?.done) };
    });
}

function parseMaterials(value, previous) {
  const previousByKey = new Map(previous.map((item) => [`${item.name}|${item.url}`, item]));
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [namePart, urlPart] = line.split("|").map((part) => part.trim());
      const isUrlOnly = /^https?:\/\//i.test(namePart);
      const material = {
        name: isUrlOnly ? namePart : namePart,
        url: urlPart || (isUrlOnly ? namePart : "")
      };
      const old = previousByKey.get(`${material.name}|${material.url}`);
      return old ? { ...old, ...material } : { id: old?.id, ...material };
    });
}

function tagLabel(tag) {
  return String(tag || "").toUpperCase();
}

function columnName(status) {
  return COLUMNS.find((column) => column.id === status)?.name || status;
}

function dateState(date) {
  if (!date) return "";
  const today = new Date(new Date().toDateString()).getTime();
  const due = new Date(`${date}T00:00:00`).getTime();
  const diff = (due - today) / 86400000;
  if (diff < 0) return "overdue";
  if (diff <= 2) return "soon";
  return "";
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function notify(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function logoSvg() {
  return `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#E6F1FB"/>
      <rect x="11" y="2" width="7" height="7" rx="1.5" fill="#85B7EB"/>
      <rect x="2" y="11" width="7" height="7" rx="1.5" fill="#85B7EB"/>
      <rect x="11" y="11" width="7" height="7" rx="1.5" fill="#E6F1FB"/>
    </svg>
  `;
}
