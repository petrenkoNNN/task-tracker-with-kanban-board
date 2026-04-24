require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/connection');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API: получить все задачи
app.get('/tasks', (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY position').all();
  res.json(tasks);
});

// API: создать задачу
app.post('/tasks', (req, res) => {
  const { title, description = '', tag = 'frontend', assignee = '?', due_date = '', column_id = 'todo' } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ error: 'Title required' });
  }
  
  const result = db.prepare(`
    INSERT INTO tasks (title, description, tag, assignee, due_date, column_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title.trim(), description, tag, assignee, due_date, column_id);
  
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(task);
});

// API: переместить задачу в другую колонку
app.put('/tasks/:id', (req, res) => {
  const { column_id } = req.body;
  db.prepare('UPDATE tasks SET column_id = ? WHERE id = ?').run(column_id, req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json(task);
});

// API: удалить задачу
app.delete('/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Раздаём фронтенд
app.use(express.static(path.join(__dirname, '../../frontend')));

// Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
