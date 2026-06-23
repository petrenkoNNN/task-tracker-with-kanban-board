import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppStore } from "./src/server/app-store.js";
import { httpError } from "./src/server/store.js";
import { saveUploadedFile } from "./src/server/uploads.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const UPLOAD_DIR = join(ROOT, "uploads");
const store = await createAppStore(ROOT);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Ошибка сервера" });
  }
}).listen(PORT, () => {
  console.log(`Innotech Kanban running at http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  const token = readCookie(req, "sid");
  const user = await store.getUserBySession(token);
  const method = req.method;
  const path = url.pathname;
  const isMultipart = String(req.headers["content-type"] || "").startsWith("multipart/form-data");
  const body = isMultipart ? {} : await readBody(req);

  if (method === "POST" && path === "/api/register") {
    const createdUser = await store.register(body);
    const loginResult = await store.login({ login: body.login, password: body.password });
    setSession(res, loginResult.token);
    sendJson(res, 201, { user: createdUser });
    return;
  }

  if (method === "POST" && path === "/api/login") {
    const result = await store.login(body);
    setSession(res, result.token);
    sendJson(res, 200, { user: result.user });
    return;
  }

  if (method === "POST" && path === "/api/logout") {
    if (token) await store.logout(token);
    clearSession(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/session") {
    sendJson(res, 200, { user });
    return;
  }

  if (!user) throw httpError(401, "Нужно войти в аккаунт");

  if (method === "POST" && path === "/api/uploads") {
    const file = await saveUploadedFile(req, { uploadDir: UPLOAD_DIR });
    sendJson(res, 201, { file });
    return;
  }

  if (method === "GET" && path === "/api/workspaces") {
    sendJson(res, 200, { workspaces: await store.listWorkspaces(user.id) });
    return;
  }

  if (method === "POST" && path === "/api/workspaces") {
    sendJson(res, 201, { workspace: await store.createWorkspace({ userId: user.id, name: body.name }) });
    return;
  }

  const workspaceMembers = path.match(/^\/api\/workspaces\/(\d+)\/members$/);
  if (workspaceMembers && method === "GET") {
    sendJson(res, 200, { members: await store.listMembers(user.id, Number(workspaceMembers[1])) });
    return;
  }
  if (workspaceMembers && method === "POST") {
    sendJson(res, 201, { member: await store.addWorkspaceMember({ userId: user.id, workspaceId: Number(workspaceMembers[1]), login: body.login }) });
    return;
  }

  if (method === "GET" && path === "/api/projects") {
    const workspaceId = requiredInt(url.searchParams.get("workspaceId"), "workspaceId");
    sendJson(res, 200, { projects: await store.listProjects(user.id, workspaceId) });
    return;
  }

  if (method === "POST" && path === "/api/projects") {
    sendJson(res, 201, { project: await store.createProject({ userId: user.id, workspaceId: Number(body.workspaceId), name: body.name }) });
    return;
  }

  if (method === "GET" && path === "/api/tasks") {
    const workspaceId = requiredInt(url.searchParams.get("workspaceId"), "workspaceId");
    const projectId = optionalInt(url.searchParams.get("projectId"));
    const tasks = await store.listTasks(user.id, {
      workspaceId,
      projectId,
      search: url.searchParams.get("search") || "",
      tag: url.searchParams.get("tag") || "",
      mode: url.searchParams.get("mode") || "active"
    });
    sendJson(res, 200, { tasks });
    return;
  }

  if (method === "POST" && path === "/api/tasks") {
    sendJson(res, 201, { task: await store.createTask(user.id, Number(body.workspaceId), body) });
    return;
  }

  const taskRoute = path.match(/^\/api\/tasks\/(\d+)$/);
  if (taskRoute && method === "PUT") {
    sendJson(res, 200, { task: await store.updateTask(user.id, Number(body.workspaceId), Number(taskRoute[1]), body) });
    return;
  }
  if (taskRoute && method === "DELETE") {
    await store.deleteTask(user.id, Number(url.searchParams.get("workspaceId") || body.workspaceId), Number(taskRoute[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  const moveRoute = path.match(/^\/api\/tasks\/(\d+)\/move$/);
  if (moveRoute && method === "POST") {
    sendJson(res, 200, { task: await store.moveTask(user.id, Number(body.workspaceId), Number(moveRoute[1]), body.status) });
    return;
  }

  const deferRoute = path.match(/^\/api\/tasks\/(\d+)\/defer$/);
  if (deferRoute && method === "POST") {
    sendJson(res, 200, { task: await store.deferTask(user.id, Number(body.workspaceId), Number(deferRoute[1]), body) });
    return;
  }

  const restoreRoute = path.match(/^\/api\/tasks\/(\d+)\/restore$/);
  if (restoreRoute && method === "POST") {
    sendJson(res, 200, { task: await store.restoreTask(user.id, Number(body.workspaceId), Number(restoreRoute[1])) });
    return;
  }

  const commentRoute = path.match(/^\/api\/tasks\/(\d+)\/comments$/);
  if (commentRoute && method === "POST") {
    sendJson(res, 201, { comment: await store.addComment(user.id, Number(body.workspaceId), Number(commentRoute[1]), body.text) });
    return;
  }

  const checklistRoute = path.match(/^\/api\/tasks\/(\d+)\/checklist\/(\d+)$/);
  if (checklistRoute && method === "POST") {
    sendJson(res, 200, { task: await store.toggleChecklist(user.id, Number(body.workspaceId), Number(checklistRoute[1]), Number(checklistRoute[2])) });
    return;
  }

  throw httpError(404, "Маршрут не найден");
}

function serveStatic(res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  const cleanPath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(ROOT, cleanPath === "/" ? "index.html" : cleanPath);
  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

async function readBody(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Некорректный JSON");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function setSession(res, token) {
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 14}`);
}

function clearSession(res) {
  res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((part) => part.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function requiredInt(value, name) {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, `${name} обязателен`);
  return id;
}

function optionalInt(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}
