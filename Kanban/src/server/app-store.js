import { join } from "node:path";
import { JsonStore } from "./store.js";
import { PostgresStore } from "./postgres-store.js";

const DEFAULT_DATABASE_URL = "postgres://kanban:kanban@127.0.0.1:55432/kanban";

export async function createAppStore(rootDir) {
  if (process.env.STORE_DRIVER === "json") {
    return new JsonStore(join(rootDir, "data", "db.json"));
  }

  const store = new PostgresStore({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL
  });
  await store.init();
  return store;
}
