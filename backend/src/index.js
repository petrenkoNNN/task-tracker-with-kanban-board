require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const tasksRouter   = require('./routes/tasks');
const columnsRouter = require('./routes/columns');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// Serve the frontend from /frontend when opening http://localhost:3000
app.use(express.static(path.join(__dirname, '../../frontend')));

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/tasks',   tasksRouter);
app.use('/columns', columnsRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Catch-all: serve the frontend SPA for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀  Innotech Kanban API running at http://localhost:${PORT}`);
  console.log(`    Frontend served at  http://localhost:${PORT}`);
  console.log(`    Health check:       http://localhost:${PORT}/health`);
});
