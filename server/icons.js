const path = require('node:path');
const sharp = require('sharp');
const { PUBLIC_DIR } = require('./config');

// O iPhone não aceita SVG como ícone da tela de início, então geramos os PNGs
// a partir de public/shared/icon.svg na primeira vez que forem pedidos.
const SOURCE = path.join(PUBLIC_DIR, 'shared', 'icon.svg');
const cache = new Map();

function render(size) {
  if (!cache.has(size)) {
    const png = sharp(SOURCE).resize(size, size).png().toBuffer();
    png.catch(() => cache.delete(size));
    cache.set(size, png);
  }
  return cache.get(size);
}

// GET /shared/icon-180.png | icon-192.png | icon-512.png
async function iconRoute(req, res) {
  const size = Number(req.params[0]);
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(await render(size));
}

module.exports = { ICON_PATH: /^\/shared\/icon-(180|192|512)\.png$/, iconRoute };
