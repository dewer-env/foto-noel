// Gera os modelos para desenhar as molduras, no tamanho exato que a Kodak 305 imprime.
// Uso: node scripts/modelos-moldura.js  →  molduras/modelos/modelo-10x15-horizontal.png etc.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { FRAMES_DIR } = require('../server/config');
const { DPI, SAFE, PAPERS, ORIENTATIONS, geometry } = require('./moldura-medidas');

function template(paper, orientation) {
  const { label } = paper;
  const { W, H, tx, ty, tw, th, band } = geometry(paper, orientation);
  const font = Math.round(Math.min(W, H) / 34);
  const center = (y, text, size = font, weight = 400, color = '#555') =>
    `<text x="${W / 2}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${text}</text>`;
  const lines = [
    [`MODELO DE MOLDURA ${label} ${orientation.toUpperCase()}`, font * 1.3, 700, '#222'],
    [`${W} x ${H} px a ${DPI} dpi`, font, 700, '#222'],
    ['', font],
    ['Centro (cinza): área da foto. Deixe transparente.', font],
    ['Dourado: borda sugerida da moldura (7% do lado menor).', font, 400, '#8a6d1e'],
    ['Linha azul: textos e logos sempre para dentro dela.', font, 400, '#1f5fbf'],
    ['Vermelho: cortado pela impressora. Só fundo da arte.', font, 400, '#b3261e'],
    ['', font],
    ['Desenhe por cima, apague este modelo e exporte em PNG', font, 700, '#222'],
    [`com fundo transparente, ${W} x ${H} px. Salve como`, font, 700, '#222'],
    [`molduras/${label}-${orientation}.png`, font * 1.1, 700, '#222'],
  ];
  const lineHeight = font * 1.55;
  const top = H / 2 - (lines.length * lineHeight) / 2 + font;
  const text = lines.map(([t, size, weight, color], i) => (t ? center(top + i * lineHeight, t, size, weight, color) : '')).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#e85a50"/>
    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="#f2d98f"/>
    <rect x="${tx + band}" y="${ty + band}" width="${tw - 2 * band}" height="${th - 2 * band}" fill="#ececec"/>
    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="none" stroke="#b3261e" stroke-width="4"/>
    <rect x="${tx + SAFE}" y="${ty + SAFE}" width="${tw - 2 * SAFE}" height="${th - 2 * SAFE}" fill="none" stroke="#1f5fbf" stroke-width="4" stroke-dasharray="24 14"/>
    ${text}
  </svg>`;
}

(async () => {
  const outDir = path.join(FRAMES_DIR, 'modelos');
  fs.mkdirSync(outDir, { recursive: true });
  for (const paper of PAPERS) {
    for (const orientation of ORIENTATIONS) {
      const file = path.join(outDir, `modelo-${paper.label}-${orientation}.png`);
      await sharp(Buffer.from(template(paper, orientation))).png().toFile(file);
      const { width, height } = await sharp(file).metadata();
      console.log(`${path.relative(process.cwd(), file)}  ${width} x ${height} px`);
    }
  }
})();
