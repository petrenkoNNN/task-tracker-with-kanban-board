const db = require('./connection');

const migrate = db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      position  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      description TEXT   DEFAULT '',
      tag        TEXT    NOT NULL DEFAULT 'frontend',
      assignee   TEXT    NOT NULL DEFAULT '?',
      due_date   TEXT    NOT NULL DEFAULT '',
      column_id  TEXT    NOT NULL DEFAULT 'todo',
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (column_id) REFERENCES columns(id)
    );
  `);

  const insertCol = db.prepare('INSERT OR IGNORE INTO columns (id, name, position) VALUES (?, ?, ?)');
  insertCol.run('todo', 'To Do', 0);
  insertCol.run('inprog', 'In Progress', 1);
  insertCol.run('review', 'Review', 2);
  insertCol.run('done', 'Done', 3);
});

try {
  migrate();
  console.log('✅ Migration done');
} catch (err) {
  console.error('Migration failed:', err.message);
}
