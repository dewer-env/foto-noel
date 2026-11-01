const fs = require('node:fs/promises');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { DISPLAY_SIZE, THUMB_SIZE } = require('./config');

// HEIC/HEIF começa com uma caixa "ftyp" seguida de uma destas marcas.
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

function looksLikeHeic(buffer) {
  return buffer.length > 12
    && buffer.toString('ascii', 4, 8) === 'ftyp'
    && HEIF_BRANDS.has(buffer.toString('ascii', 8, 12));
}

async function render(input, displayPath, thumbPath) {
  // .rotate() sem argumentos aplica a orientação EXIF e a remove do arquivo final.
  const base = sharp(input, { failOn: 'none' }).rotate();
  await Promise.all([
    base.clone()
      .resize({ width: DISPLAY_SIZE, height: DISPLAY_SIZE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(displayPath),
    base.clone()
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbPath),
  ]);
}

// Gera as versões display e thumb a partir do original.
// O sharp pré-compilado nem sempre decodifica HEIC (codec HEVC); nesse caso
// convertemos para JPEG com o heic-convert (JS puro, funciona em qualquer SO).
async function processPhoto(originalPath, displayPath, thumbPath) {
  const input = await fs.readFile(originalPath);
  try {
    await render(input, displayPath, thumbPath);
  } catch (err) {
    if (!looksLikeHeic(input)) throw err;
    const jpeg = await heicConvert({ buffer: input, format: 'JPEG', quality: 0.95 });
    await render(Buffer.from(jpeg), displayPath, thumbPath);
  }
}

module.exports = { processPhoto, looksLikeHeic };
