/**
 * seed.js – populate the database with demo tasks.
 * Usage: npm run seed
 * Safe to re-run: clears tasks before inserting.
 */
const db = require('./connection');

const demoTasks = [
  { title: 'Design Kanban board mockup',    description: 'Create wireframes for the board UI in Figma',               tag: 'design',   assignee: 'AK', due_date: 'Apr 24', column_id: 'done',   position: 0 },
  { title: 'Set up REST API endpoints',     description: 'GET / POST / PUT / DELETE for tasks resource',              tag: 'backend',  assignee: 'MS', due_date: 'Apr 25', column_id: 'done',   position: 1 },
  { title: 'Database schema & migrations',  description: 'Design tasks table and run initial migration',              tag: 'backend',  assignee: 'MS', due_date: 'Apr 26', column_id: 'inprog', position: 0 },
  { title: 'Frontend board component',      description: 'Render columns and cards, connect to API',                  tag: 'frontend', assignee: 'NP', due_date: 'Apr 27', column_id: 'inprog', position: 1 },
  { title: 'Drag & drop between columns',   description: 'Implement HTML5 drag and drop for task cards',              tag: 'frontend', assignee: 'NP', due_date: 'Apr 28', column_id: 'review', position: 0 },
  { title: 'CI/CD pipeline setup',          description: 'Configure GitHub Actions for automatic deployment',         tag: 'devops',   assignee: 'VT', due_date: 'Apr 29', column_id: 'todo',   position: 0 },
  { title: 'Write API integration tests',   description: 'Cover all CRUD endpoints with Postman test collection',     tag: 'qa',       assignee: 'LB', due_date: 'Apr 30', column_id: 'todo',   position: 1 },
  { title: 'Add task search & filtering',   description: 'Filter by tag and keyword search on the Kanban board',      tag: 'frontend', assignee: 'NP', due_date: 'May 2',  column_id: 'todo',   position: 2 },
];

const seed = db.transaction(() => {
  db.exec('DELETE FROM tasks');
  db.exec("DELETE FROM sqlite_sequence WHERE name='tasks'");

  const insert = db.prepare(`
    INSERT INTO tasks (title, description, tag, assignee, due_date, column_id, position)
    VALUES (@title, @description, @tag, @assignee, @due_date, @column_id, @position)
  `);

  for (const task of demoTasks) insert.run(task);
});

try {
  seed();
  console.log(`✅  Seeded ${demoTasks.length} demo tasks.`);
} catch (err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
}
