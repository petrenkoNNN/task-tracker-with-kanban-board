# Innotech Kanban Board

Full-stack task tracker built for **Innotech (T1 Holding)** — Node.js/Express backend + SQLite database + vanilla JS frontend.

---

## Stack

| Layer     | Technology                  |
|-----------|-----------------------------|
| Backend   | Node.js · Express 4         |
| Database  | SQLite via `better-sqlite3` |
| Frontend  | HTML · CSS · Vanilla JS     |
| Served by | Express static middleware   |

---

## Local Setup (5 minutes)

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Default values work out of the box for local development — no changes needed.

### 3. Run the database migration

```bash
npm run migrate
```

This creates `kanban.db` with the `columns` and `tasks` tables.

### 4. (Optional) Seed demo data

```bash
npm run seed
```

Loads 8 demo tasks across all four columns.

### 5. Start the server

```bash
npm start          # production
# or
npm run dev        # auto-restart with nodemon
```

Open **http://localhost:3000** — the frontend loads automatically.

---

## API Reference

Base URL: `http://localhost:3000`

### Tasks

| Method   | Endpoint       | Description                        |
|----------|----------------|------------------------------------|
| `GET`    | `/tasks`       | List all tasks (supports filters)  |
| `GET`    | `/tasks/:id`   | Get single task                    |
| `POST`   | `/tasks`       | Create a task                      |
| `PUT`    | `/tasks/:id`   | Update a task (partial)            |
| `DELETE` | `/tasks/:id`   | Delete a task                      |
| `GET`    | `/columns`     | List all columns                   |
| `GET`    | `/health`      | Health check                       |

### Query params for `GET /tasks`

| Param       | Example            | Description        |
|-------------|--------------------|--------------------|
| `q`         | `?q=api`           | Full-text search   |
| `tag`       | `?tag=backend`     | Filter by tag      |
| `column_id` | `?column_id=todo`  | Filter by column   |

### Task body fields

```json
{
  "title":       "Task title",
  "description": "Optional details",
  "tag":         "frontend | backend | design | devops | qa",
  "assignee":    "AK",
  "due_date":    "Apr 28",
  "column_id":   "todo | inprog | review | done",
  "position":    0
}
```

Only `title` is required on `POST`. All fields are optional on `PUT`.

---

## Database Schema

```sql
CREATE TABLE columns (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT    DEFAULT '',
  tag         TEXT    NOT NULL DEFAULT 'frontend',
  assignee    TEXT    NOT NULL DEFAULT '?',
  due_date    TEXT    NOT NULL DEFAULT '',
  column_id   TEXT    NOT NULL DEFAULT 'todo',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (column_id) REFERENCES columns(id)
);
```

---

## Project Structure

```
innotech-kanban/
├── backend/
│   ├── src/
│   │   ├── index.js            ← Express entry point
│   │   ├── db/
│   │   │   ├── connection.js   ← SQLite connection
│   │   │   ├── migrate.js      ← Schema creation
│   │   │   └── seed.js         ← Demo data
│   │   ├── routes/
│   │   │   ├── tasks.js        ← CRUD endpoints
│   │   │   └── columns.js      ← Column list endpoint
│   │   └── middleware/
│   │       └── validate.js     ← Request validation
│   ├── .env.example
│   └── package.json
└── frontend/
    └── index.html              ← Single-page Kanban UI
```

---

## Deployment (Render / Railway)

1. Push the repo to GitHub.
2. Create a new **Web Service** pointing to the `backend/` folder.
3. Set build command: `npm install && npm run migrate`
4. Set start command: `npm start`
5. Add env var `PORT` (Render sets this automatically).
6. The frontend is served from `../frontend` by Express — no separate deploy needed.

For separate frontend hosting (Vercel, Netlify), update `API` constant in `frontend/index.html` to point at your live backend URL.
