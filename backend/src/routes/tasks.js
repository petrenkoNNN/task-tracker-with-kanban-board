const express = require('express');
const router  = express.Router();
const db      = require('../db/connection');
const { validateTask } = require('../middleware/validate');

// ── GET /tasks ──────────────────────────────────────────────────────────────
// Returns all tasks ordered by column position then task position.
// Optional query params: ?column_id=todo  ?tag=backend  ?q=search
router.get('/', (req, res) => {
  const { column_id, tag, q } = req.query;
  let sql    = 'SELECT * FROM tasks WHERE 1=1';
  const args = [];

  if (column_id) { sql += ' AND column_id = ?'; args.push(column_id); }
  if (tag)       { sql += ' AND tag = ?';       args.push(tag); }
  if (q)         { sql += ' AND (title LIKE ? OR description LIKE ?)';
                   args.push(`%${q}%`, `%${q}%`); }

  sql += ' ORDER BY position ASC, id ASC';

  try {
    const tasks = db.prepare(sql).all(...args);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tasks/:id ──────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// ── POST /tasks ─────────────────────────────────────────────────────────────
router.post('/', validateTask, (req, res) => {
  const {
    title,
    description = '',
    tag         = 'frontend',
    assignee    = '?',
    due_date    = '',
    column_id   = 'todo',
    position    = 0,
  } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO tasks (title, description, tag, assignee, due_date, column_id, position)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title.trim(), description, tag, assignee, due_date, column_id, position);

    const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /tasks/:id ──────────────────────────────────────────────────────────
// Partial update: only fields present in the body are updated.
router.put('/:id', validateTask, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const allowed = ['title', 'description', 'tag', 'assignee', 'due_date', 'column_id', 'position'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');

  try {
    db.prepare(`UPDATE tasks SET ${setClause} WHERE id = @id`).run({ ...updates, id: req.params.id });
    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /tasks/:id ───────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  try {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.json({ success: true, deleted: task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
