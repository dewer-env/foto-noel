const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const events = require('../events');
const { processPhoto } = require('../images');
const { DATA_DIR, PHOTOS_DIR, TMP_DIR, MAX_UPLOAD_BYTES } = require('../config');

fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

const router = express.Router();

// Uploads em andamento por clientPhotoId: se o cliente reenviar enquanto o
// primeiro envio ainda está sendo processado, os dois recebem o mesmo id.
const inFlight = new Map();

function extensionFor(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
  if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif') return '.heic';
  if (file.mimetype === 'image/png') return '.png';
  return '.jpg';
}

// Pastas pensadas para um humano achar as fotos no Finder/Explorer se o balcão falhar:
//   fotos/2026-10-29/familia-047/047_143012_a1b2.jpg       ← original
//   fotos/2026-10-29/familia-047/_versoes/<id>-display.jpg ← versões geradas
// O dia é o da família (não o de agora), para uma família que atravessa a meia-noite
// não se misturar com a família de mesmo número do dia seguinte.
async function storePhoto({ file, session, clientPhotoId }) {
  const id = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const code = String(session.code).padStart(3, '0');
  const familyDir = path.join(PHOTOS_DIR, session.day, `familia-${code}`);
  const versionsDir = path.join(familyDir, '_versoes');
  await fsp.mkdir(versionsDir, { recursive: true });

  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join('');
  const abs = {
    original: path.join(familyDir, `${code}_${time}_${id.slice(0, 4)}${extensionFor(file)}`),
    display: path.join(versionsDir, `${id}-display.jpg`),
    thumb: path.join(versionsDir, `${id}-thumb.jpg`),
  };
  await fsp.rename(file.path, abs.original);

  try {
    await processPhoto(abs.original, abs.display, abs.thumb);
  } catch (err) {
    // Mantém o original guardado (nenhuma foto se perde), mas recusa o registro.
    console.error(`[fotos] falha ao processar ${abs.original}:`, err.message);
    await Promise.allSettled([fsp.rm(abs.display, { force: true }), fsp.rm(abs.thumb, { force: true })]);
    const e = new Error('Não foi possível ler a imagem');
    e.status = 422;
    throw e;
  }

  // Caminhos relativos a data/, com "/" para funcionar igual em Windows e Mac.
  const rel = (p) => path.relative(DATA_DIR, p).split(path.sep).join('/');
  const photo = db.insertPhoto({
    id, clientPhotoId, sessionId: session.id, createdAt,
    pathOriginal: rel(abs.original),
    pathDisplay: rel(abs.display),
    pathThumb: rel(abs.thumb),
  });
  events.broadcast({ type: 'photo.created', photo: { id: photo.id, sessionId: photo.sessionId, code: photo.code } });
  console.log(`[fotos] família ${photo.code}: ${rel(abs.original)}`);
  return photo.id;
}

router.post('/', upload.single('file'), async (req, res) => {
  const discardUpload = () => req.file && fsp.rm(req.file.path, { force: true }).catch(() => {});
  const { sessionId, clientPhotoId } = req.body || {};

  if (!req.file) return res.status(400).json({ error: 'Campo "file" ausente' });
  if (!clientPhotoId) { discardUpload(); return res.status(400).json({ error: 'Campo "clientPhotoId" ausente' }); }

  const existingId = db.findPhotoIdByClientId(clientPhotoId);
  if (existingId) { discardUpload(); return res.status(200).json({ id: existingId }); }

  const pending = inFlight.get(clientPhotoId);
  if (pending) {
    try {
      const id = await pending;
      discardUpload();
      return res.status(200).json({ id });
    } catch { /* o primeiro falhou: segue e tenta com este arquivo */ }
  }

  const session = sessionId && db.getSession(sessionId);
  if (!session) {
    discardUpload();
    return res.status(400).json({ error: 'sessionId inválido' });
  }

  const job = storePhoto({ file: req.file, session, clientPhotoId });
  inFlight.set(clientPhotoId, job);
  try {
    res.status(201).json({ id: await job });
  } catch (err) {
    discardUpload();
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    inFlight.delete(clientPhotoId);
  }
});

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 5000);
  const { sessionId, day, since } = req.query;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'day deve ser AAAA-MM-DD' });
  res.json(db.listPhotos({ sessionId: sessionId || undefined, day: day || undefined, since: since || undefined, limit }));
});

router.get('/:id', (req, res) => {
  const photo = db.getPhoto(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Foto não encontrada' });
  res.json(photo);
});

const FILE_COLUMNS = { original: 'path_original', display: 'path_display', thumb: 'path_thumb' };

router.get('/:id/:variant', (req, res, next) => {
  const column = FILE_COLUMNS[req.params.variant];
  if (!column) return next();
  const row = db.getPhotoRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Foto não encontrada' });
  // Os arquivos nunca mudam depois de gerados; o cache longo alivia o Wi-Fi.
  res.sendFile(path.join(DATA_DIR, row[column]), { maxAge: '365d', immutable: true });
});

router.patch('/:id', express.json(), (req, res) => {
  if (!db.getPhoto(req.params.id)) return res.status(404).json({ error: 'Foto não encontrada' });
  const { hiddenFromDisplay } = req.body || {};
  if (typeof hiddenFromDisplay !== 'boolean') return res.status(400).json({ error: '"hiddenFromDisplay" deve ser true/false' });

  const photo = db.setHiddenFromDisplay(req.params.id, hiddenFromDisplay);
  events.broadcast({ type: 'photo.updated', photo: { id: photo.id, hiddenFromDisplay: photo.hiddenFromDisplay } });
  res.json(photo);
});

module.exports = router;
