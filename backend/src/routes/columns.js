const express = require('express');
const router  = express.Router();
const db      = require('../db/connection');

// GET /columns – list all columns ordered by position
router.get('/', (req, res) => {
  try {
    const columns = db.prepare('SELECT * FROM columns ORDER BY position ASC').all();
    res.json(columns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
