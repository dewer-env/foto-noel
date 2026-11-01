const express = require('express');
const db = require('../db');
const events = require('../events');

const router = express.Router();

router.post('/', (req, res) => {
  const session = db.createSession();
  events.broadcast({ type: 'session.created', session });
  console.log(`[famílias] nova família ${session.code}`);
  res.status(201).json(session);
});

router.get('/current', (req, res) => {
  res.json(db.getCurrentSession());
});

module.exports = router;
