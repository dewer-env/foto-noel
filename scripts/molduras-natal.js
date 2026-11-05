// Gera as molduras prontas, cada uma na sua pasta: molduras/natal/, molduras/neve/.
// Uso: node scripts/molduras-natal.js  (substitui os arquivos dessas pastas)
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { FRAMES_DIR } = require('../server/config');
const { PAPERS, ORIENTATIONS, geometry } = require('./moldura-medidas');
const { FLAKE, HOLLY } = require('./moldura-enfeites');

const THEMES = [
  // Borda vermelha com filete dourado, azevinho nos cantos, flocos de neve e "Feliz Natal".
  { id: 'natal', colors: ['#7a1010', '#b71c1c'], line: '#e9c46a', text: 'Feliz Natal', holly: true },
  // Variação simples, para testar a troca de moldura: azul, prata e "Boas Festas".
  { id: 'neve', colors: ['#0b2545', '#1d4e89'], line: '#dfe8f2', text: 'Boas Festas', holly: false },
];

function frame(paper, orientation, theme) {
  const { W, H, tx, ty, tw, th, band } = geometry(paper, orientation);
  // Janela da foto: o corte menos a borda.
  const wx = tx + band;
  const wy = ty + band;
  const ww = tw - 2 * band;
  const wh = th - 2 * band;
  const mid = band / 2; // linha central da borda, a partir do corte

  const holly = (x, y, angle) =>
    `<use xlink:href="#holly" transform="translate(${x} ${y}) rotate(${angle}) scale(${(band * 1.7) / 100})"/>`;
  const corners = theme.holly ? [
    holly(tx + mid, ty + mid, 0),
    holly(tx + tw - mid, ty + mid, 90),
    holly(tx + tw - mid, ty + th - mid, 180),
    holly(tx + mid, ty + th - mid, 270),
  ].join('') : '';

  // Flocos ao longo da linha central da borda, longe do azevinho e do texto.
  const fontSize = band * 0.62;
  const textHalf = (fontSize * 0.5 * theme.text.length) / 2 + band * 0.8;
  const flakes = [];
  const step = band * 1.6;
  const clear = theme.holly ? band * 2.4 : band * 0.9;
  const flake = (x, y, i) => flakes.push(
    `<use xlink:href="#flake" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${((band * (i % 2 ? 0.2 : 0.28)) / 10).toFixed(3)})" opacity="${i % 2 ? 0.75 : 0.95}"/>`,
  );
  let i = 0;
  for (let x = tx + clear; x <= tx + tw - clear; x += step) {
    flake(x, ty + mid, i++);
    if (Math.abs(x - W / 2) > textHalf) flake(x, ty + th - mid, i);
  }
  for (let y = ty + clear; y <= ty + th - clear; y += step) {
    flake(tx + mid, y, i++);
    flake(tx + tw - mid, y, i);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">
    <defs>
      <linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${theme.colors[0]}"/>
        <stop offset=".5" stop-color="${theme.colors[1]}"/>
        <stop offset="1" stop-color="${theme.colors[0]}"/>
      </linearGradient>
      ${FLAKE}
      ${HOLLY}
    </defs>
    <path fill="url(#red)" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${wx} ${wy}V${wy + wh}H${wx + ww}V${wy}Z"/>
    <rect x="${wx - band * 0.06}" y="${wy - band * 0.06}" width="${ww + band * 0.12}" height="${wh + band * 0.12}" fill="none" stroke="${theme.line}" stroke-width="${band * 0.08}"/>
    ${flakes.join('')}
    ${corners}
    <text x="${W / 2}" y="${ty + th - mid + fontSize * 0.34}" font-size="${fontSize}" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-weight="700" fill="${theme.line}" text-anchor="middle">${theme.text}</text>
  </svg>`;
}

(async () => {
  for (const theme of THEMES) {
    const dir = path.join(FRAMES_DIR, theme.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const paper of PAPERS) {
      for (const orientation of ORIENTATIONS) {
        const file = path.join(dir, `${paper.label}-${orientation}.png`);
        await sharp(Buffer.from(frame(paper, orientation, theme))).png().toFile(file);
        const { width, height } = await sharp(file).metadata();
        console.log(`${path.relative(process.cwd(), file)}  ${width} x ${height} px`);
      }
    }
  }
})();
