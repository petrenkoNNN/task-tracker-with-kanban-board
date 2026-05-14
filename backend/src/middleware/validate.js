const VALID_TAGS    = ['frontend', 'backend', 'design', 'devops', 'qa'];
const VALID_COLUMNS = ['todo', 'inprog', 'review', 'done'];

function validateTask(req, res, next) {
  const { title, tag, column_id } = req.body;

  if (title !== undefined && (!title || typeof title !== 'string' || title.trim().length === 0)) {
    return res.status(400).json({ error: 'title is required and must be a non-empty string' });
  }

  if (tag !== undefined && !VALID_TAGS.includes(tag)) {
    return res.status(400).json({ error: `tag must be one of: ${VALID_TAGS.join(', ')}` });
  }

  if (column_id !== undefined && !VALID_COLUMNS.includes(column_id)) {
    return res.status(400).json({ error: `column_id must be one of: ${VALID_COLUMNS.join(', ')}` });
  }

  next();
}

module.exports = { validateTask };
