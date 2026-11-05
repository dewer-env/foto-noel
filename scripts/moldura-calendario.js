// Gera a moldura de calendário em molduras/calendario/: a foto ao lado (horizontal) ou acima
// (vertical) dos 12 meses do ano seguinte ao evento, num cartão creme dentro de uma borda
// de Natal (vermelha, com flocos de neve e azevinho).
// Uso: node scripts/moldura-calendario.js  (substitui os arquivos da pasta)
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { FRAMES_DIR } = require('../server/config');
const { PAPERS, ORIENTATIONS, geometry } = require('./moldura-medidas');
const { FLAKE, HOLLY, holly, flake } = require('./moldura-enfeites');

const YEAR = 2027; // o evento é no Natal de 2026
const NAME = `Calendário ${YEAR}`;
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const RED = '#a4161a';
const GREEN = '#1e6b34';
const GOLD = '#e9c46a';
const SERIF = "Georgia, 'Times New Roman', serif";
const INK = '#3b3330';
const PAPER = '#fbf6ec';
const SANS = 'Arial, Helvetica, sans-serif';

function text(x, y, value, size, { color = INK, weight = 400, anchor = 'middle', family = SANS, style = 'normal' } = {}) {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size.toFixed(1)}" font-family="${family}" font-style="${style}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${value}</text>`;
}

// Um mês: nome, dias da semana e até 6 semanas, dentro do retângulo dado.
function month(index, x, y, w, h) {
  const size = Math.min(h / 10.8, w / (7 * 1.45));
  const colW = w / 7;
  const parts = [text(x + w / 2, y + size * 1.15, MONTHS[index], size * 1.15, { color: RED, weight: 700 })];
  WEEKDAYS.forEach((d, i) => parts.push(text(x + colW * (i + 0.5), y + size * 2.75, d, size * 0.85, { color: i === 0 ? RED : '#8a7f78', weight: 700 })));
  const first = new Date(YEAR, index, 1).getDay();
  const days = new Date(YEAR, index + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    const slot = first + day - 1;
    const col = slot % 7;
    const row = Math.floor(slot / 7);
    parts.push(text(x + colW * (col + 0.5), y + size * (4.25 + row * 1.3), day, size, { color: col === 0 ? RED : INK }));
  }
  return parts.join('');
}

function frame(paper, orientation) {
  const { W, H, tx, ty, tw, th, band } = geometry(paper, orientation);
  const horizontal = orientation === 'horizontal';

  // Borda vermelha de Natal em volta de um cartão creme.
  const edge = band * 0.8;
  const card = { x: tx + edge, y: ty + edge, w: tw - 2 * edge, h: th - 2 * edge };
  const margin = band * 0.55;
  const gap = band * 0.6;

  // Dentro do cartão: foto à esquerda (horizontal) ou em cima (vertical); calendário no resto.
  const inner = { x: card.x + margin, y: card.y + margin, w: card.w - 2 * margin, h: card.h - 2 * margin };
  const photo = horizontal
    ? { x: inner.x, y: inner.y, w: (inner.w - gap) * 0.62, h: inner.h }
    : { x: inner.x, y: inner.y, w: inner.w, h: (inner.h - gap) * 0.64 };
  const panel = horizontal
    ? { x: photo.x + photo.w + gap, y: photo.y, w: inner.w - gap - photo.w, h: photo.h }
    : { x: photo.x, y: photo.y + photo.h + gap, w: photo.w, h: inner.h - gap - photo.h };

  // Título: duas linhas na coluna estreita (horizontal), uma linha na faixa larga (vertical).
  const titleH = panel.h * (horizontal ? 0.19 : 0.2);
  const cx = panel.x + panel.w / 2;
  let title;
  if (horizontal) {
    const size = Math.min(titleH * 0.42, panel.w / 6.2);
    title = text(cx, panel.y + titleH * 0.42, 'Feliz Natal', size, { color: RED, weight: 700, family: SERIF, style: 'italic' })
      + text(cx, panel.y + titleH * 0.88, YEAR, size * 0.95, { color: GREEN, weight: 700, family: SERIF });
  } else {
    const size = Math.min(titleH * 0.6, panel.w / 10);
    title = `<text x="${cx.toFixed(1)}" y="${(panel.y + titleH * 0.68).toFixed(1)}" font-size="${size.toFixed(1)}" font-family="${SERIF}" font-weight="700" text-anchor="middle">`
      + `<tspan fill="${RED}" font-style="italic">Feliz Natal</tspan><tspan fill="${GOLD}" dx="${(size * 0.3).toFixed(1)}">·</tspan><tspan fill="${GREEN}" dx="${(size * 0.3).toFixed(1)}">${YEAR}</tspan></text>`;
  }

  const [cols, rows] = horizontal ? [3, 4] : [6, 2];
  const cellW = panel.w / cols;
  const cellH = (panel.h - titleH) / rows;
  const pad = Math.min(cellW, cellH) * 0.06;
  const months = [];
  for (let i = 0; i < 12; i++) {
    const mx = panel.x + (i % cols) * cellW;
    const my = panel.y + titleH + Math.floor(i / cols) * cellH;
    months.push(month(i, mx + pad, my + pad, cellW - 2 * pad, cellH - 2 * pad));
  }

  // Flocos ao longo da borda vermelha, longe do azevinho dos cantos.
  const mid = edge / 2;
  const flakes = [];
  const step = edge * 1.9;
  const clear = edge * 2.6;
  let n = 0;
  const add = (x, y) => { flakes.push(flake(x, y, edge * (n % 2 ? 0.2 : 0.28), n % 2 ? 0.75 : 0.95)); n++; };
  // Posições centradas no lado, para sobrar o mesmo espaço perto dos dois cantos.
  const along = (start, length) => {
    const count = Math.floor((length - 2 * clear) / step);
    return Array.from({ length: count + 1 }, (_, k) => start + length / 2 + (k - count / 2) * step);
  };
  for (const x of along(tx, tw)) { add(x, ty + mid); add(x, ty + th - mid); }
  for (const y of along(ty, th)) { add(tx + mid, y); add(tx + tw - mid, y); }
  const corners = [
    holly(tx + mid, ty + mid, 0, edge * 1.7),
    holly(tx + tw - mid, ty + mid, 90, edge * 1.7),
    holly(tx + tw - mid, ty + th - mid, 180, edge * 1.7),
    holly(tx + mid, ty + th - mid, 270, edge * 1.7),
  ].join('');

  const hole = `M${photo.x} ${photo.y}V${photo.y + photo.h}H${photo.x + photo.w}V${photo.y}Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">
    <defs>
      <linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7a1010"/>
        <stop offset=".5" stop-color="#b71c1c"/>
        <stop offset="1" stop-color="#7a1010"/>
      </linearGradient>
      ${FLAKE}
      ${HOLLY}
    </defs>
    <path fill="url(#red)" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z ${hole}"/>
    <path fill="${PAPER}" fill-rule="evenodd" d="M${card.x} ${card.y}H${card.x + card.w}V${card.y + card.h}H${card.x}Z ${hole}"/>
    <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" fill="none" stroke="${GOLD}" stroke-width="${band * 0.07}"/>
    <rect x="${photo.x}" y="${photo.y}" width="${photo.w}" height="${photo.h}" fill="none" stroke="${RED}" stroke-width="${band * 0.1}"/>
    ${flakes.join('')}
    ${corners}
    ${title}
    ${months.join('')}
  </svg>`;
}

(async () => {
  const dir = path.join(FRAMES_DIR, 'calendario');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'nome.txt'), `${NAME}\n`);
  for (const paper of PAPERS) {
    for (const orientation of ORIENTATIONS) {
      const file = path.join(dir, `${paper.label}-${orientation}.png`);
      await sharp(Buffer.from(frame(paper, orientation))).png().toFile(file);
      const { width, height } = await sharp(file).metadata();
      console.log(`${path.relative(process.cwd(), file)}  ${width} x ${height} px`);
    }
  }
})();
