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

// O sharp pré-compilado nem sempre decodifica HEIC (codec HEVC); nesse caso
// convertemos para JPEG com o heic-convert (JS puro, funciona em qualquer SO).
async function withHeicFallback(originalPath, work) {
  const input = await fs.readFile(originalPath);
  try {
    await work(input);
  } catch (err) {
    if (!looksLikeHeic(input)) throw err;
    const jpeg = await heicConvert({ buffer: input, format: 'JPEG', quality: 0.95 });
    await work(Buffer.from(jpeg));
  }
}

// Gera as versões display e thumb a partir do original.
async function processPhoto(originalPath, displayPath, thumbPath) {
  await withHeicFallback(originalPath, (input) => render(input, displayPath, thumbPath));
}

// Versão para impressão: resolução total, já girada e em JPEG. O Windows não lê
// HEIC e ignora a orientação EXIF, então o original não serve direto.
async function printVersion(originalPath, printPath) {
  await withHeicFallback(originalPath, (input) =>
    sharp(input, { failOn: 'none' }).rotate().jpeg({ quality: 95 }).toFile(printPath));
}

async function isLandscape(imagePath) {
  const { width, height } = await sharp(imagePath).metadata();
  return width > height;
}

// Retângulo que envolve a parte transparente da moldura: é onde a foto entra.
// Sem parte transparente, a foto ocupa a folha toda.
function transparentBox(data, { width, height, channels }) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let x = 0; x < width; x++) {
      if (data[row + x * channels + channels - 1] >= 128) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return { left: 0, top: 0, width, height };
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// Foto encaixada na área transparente da moldura (corta o excesso no centro) e a moldura
// por cima. A moldura é esticada para o tamanho exato; os modelos já têm a proporção certa.
async function framedVersion(photoPath, framePath, width, height, quality = 95) {
  const frame = await sharp(framePath).resize(width, height, { fit: 'fill' }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const hole = transparentBox(frame.data, frame.info);
  const photo = await sharp(photoPath).resize(hole.width, hole.height, { fit: 'cover' }).toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([
      { input: photo, left: hole.left, top: hole.top },
      { input: frame.data, raw: frame.info },
    ])
    .jpeg({ quality })
    .toBuffer();
}

module.exports = { processPhoto, printVersion, isLandscape, framedVersion, looksLikeHeic };
