const fsp = require('node:fs/promises');
const express = require('express');
const db = require('../db');
const events = require('../events');
const { DATA_DIR, VERSION, localDay } = require('../config');

const router = express.Router();

router.get('/', async (req, res) => {
  const disk = await fsp.statfs(DATA_DIR);
  res.json({
    ok: true,
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    connectedClients: events.clientCount(),
    today: db.getDayStats(localDay()),
    disk: { freeBytes: disk.bavail * disk.bsize, totalBytes: disk.blocks * disk.bsize },
  });
});

module.exports = router;
