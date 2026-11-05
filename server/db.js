const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, DB_PATH, localDay } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    code       INTEGER NOT NULL,
    day        TEXT NOT NULL,          -- AAAA-MM-DD local; o código reinicia por dia
    created_at TEXT NOT NULL,
    UNIQUE (day, code)
  );

  CREATE TABLE IF NOT EXISTS photos (
    id                  TEXT PRIMARY KEY,
    client_photo_id     TEXT NOT NULL UNIQUE,
    session_id          TEXT NOT NULL REFERENCES sessions(id),
    path_original       TEXT NOT NULL,   -- relativo a data/
    path_display        TEXT NOT NULL,
    path_thumb          TEXT NOT NULL,
    hidden_from_display INTEGER NOT NULL DEFAULT 0,
    print_count         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_photos_created ON photos (created_at);
  CREATE INDEX IF NOT EXISTS idx_photos_session ON photos (session_id);
`);

const stmt = {
  lastSessionOfDay: db.prepare('SELECT id, code, day, created_at FROM sessions WHERE day = ? ORDER BY code DESC LIMIT 1'),
  insertSession: db.prepare('INSERT INTO sessions (id, code, day, created_at) VALUES (?, ?, ?, ?)'),
  sessionById: db.prepare('SELECT id, code, day, created_at FROM sessions WHERE id = ?'),
  photoById: db.prepare(`
    SELECT p.*, s.code, s.day FROM photos p JOIN sessions s ON s.id = p.session_id WHERE p.id = ?`),
  photoByClientId: db.prepare('SELECT id FROM photos WHERE client_photo_id = ?'),
  insertPhoto: db.prepare(`
    INSERT INTO photos (id, client_photo_id, session_id, path_original, path_display, path_thumb, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  setHidden: db.prepare('UPDATE photos SET hidden_from_display = ? WHERE id = ?'),
  addPrint: db.prepare('UPDATE photos SET print_count = print_count + 1 WHERE id = ?'),
  dayStats: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sessions WHERE day = ?) AS families,
      (SELECT COUNT(*) FROM photos p JOIN sessions s ON s.id = p.session_id WHERE s.day = ?) AS photos,
      (SELECT MAX(p.created_at) FROM photos p JOIN sessions s ON s.id = p.session_id WHERE s.day = ?) AS last_photo_at`),
};

function toSession(row) {
  return row && { id: row.id, code: row.code, day: row.day, createdAt: row.created_at };
}

function toPhoto(row) {
  return row && {
    id: row.id,
    clientPhotoId: row.client_photo_id,
    sessionId: row.session_id,
    code: row.code,
    day: row.day,
    hiddenFromDisplay: !!row.hidden_from_display,
    printCount: row.print_count,
    createdAt: row.created_at,
  };
}

function createSession() {
  const day = localDay();
  const last = stmt.lastSessionOfDay.get(day);
  const session = { id: crypto.randomUUID(), code: last ? last.code + 1 : 1, day, created_at: new Date().toISOString() };
  stmt.insertSession.run(session.id, session.code, day, session.created_at);
  return toSession(session);
}

// Sessão mais recente do dia; se ainda não houver nenhuma hoje, cria a primeira.
function getCurrentSession() {
  const row = stmt.lastSessionOfDay.get(localDay());
  return row ? toSession(row) : createSession();
}

function getSession(id) {
  return toSession(stmt.sessionById.get(id));
}

function getPhoto(id) {
  return toPhoto(stmt.photoById.get(id));
}

function getPhotoRow(id) {
  return stmt.photoById.get(id);
}

function findPhotoIdByClientId(clientPhotoId) {
  return stmt.photoByClientId.get(clientPhotoId)?.id;
}

function insertPhoto(p) {
  stmt.insertPhoto.run(p.id, p.clientPhotoId, p.sessionId, p.pathOriginal, p.pathDisplay, p.pathThumb, p.createdAt);
  return getPhoto(p.id);
}

// Com `since`: fotos mais novas que `since`, em ordem cronológica.
// Sem `since`: as `limit` mais recentes, também em ordem cronológica.
function listPhotos({ sessionId, day, since, limit }) {
  const where = [];
  const params = [];
  if (sessionId) { where.push('p.session_id = ?'); params.push(sessionId); }
  if (day) { where.push('s.day = ?'); params.push(day); }
  if (since) { where.push('p.created_at > ?'); params.push(since); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = since ? 'ASC' : 'DESC';
  const rows = db.prepare(`
    SELECT p.*, s.code, s.day FROM photos p JOIN sessions s ON s.id = p.session_id
    ${whereSql} ORDER BY p.created_at ${order} LIMIT ?`).all(...params, limit);
  if (!since) rows.reverse();
  return rows.map(toPhoto);
}

function getDayStats(day) {
  const row = stmt.dayStats.get(day, day, day);
  return { families: row.families, photos: row.photos, lastPhotoAt: row.last_photo_at };
}

function setHiddenFromDisplay(id, hidden) {
  stmt.setHidden.run(hidden ? 1 : 0, id);
  return getPhoto(id);
}

// Conta quando o Windows aceita a impressão, não quando a foto sai da impressora.
function addPrint(id) {
  stmt.addPrint.run(id);
  return getPhoto(id);
}

module.exports = {
  db,
  createSession,
  getCurrentSession,
  getSession,
  getPhoto,
  getPhotoRow,
  findPhotoIdByClientId,
  insertPhoto,
  listPhotos,
  getDayStats,
  setHiddenFromDisplay,
  addPrint,
};
