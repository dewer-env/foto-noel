const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

module.exports = {
  ROOT,
  PORT: Number(process.env.PORT) || 3000,
  VERSION: require('../package.json').version,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  FRAMES_DIR: path.join(ROOT, 'molduras'),
  DATA_DIR,
  PHOTOS_DIR: path.join(DATA_DIR, 'fotos'),
  TMP_DIR: path.join(DATA_DIR, 'tmp'),
  DB_PATH: path.join(DATA_DIR, 'db.sqlite'),
  DISPLAY_SIZE: 2048,
  THUMB_SIZE: 400,
  MAX_UPLOAD_BYTES: 60 * 1024 * 1024,
};

// Data local (fuso do computador) no formato AAAA-MM-DD.
module.exports.localDay = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
