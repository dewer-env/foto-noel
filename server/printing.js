// Impressão direta na Kodak 305, sem diálogo. Por enquanto só no Windows: o
// servidor chama o imprimir.ps1, que usa a impressão nativa do sistema.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const sharp = require('sharp');
const { DATA_DIR, TMP_DIR, FRAMES_DIR } = require('./config');
const { printVersion, isLandscape, framedVersion } = require('./images');

const SUPPORTED = process.platform === 'win32';
const SCRIPT = path.join(__dirname, 'imprimir.ps1');
const SCRIPT_TIMEOUT_MS = 60000;
const PRINTER_CACHE_MS = 5 * 60 * 1000;

// Medidas em centésimos de polegada, a unidade em que o Windows informa os papéis.
// `kodak`: o papel como o driver da Kodak 305 informa (com a sobra), usado na prévia,
// que não pode depender do driver para funcionar também no Mac.
const SIZES = {
  '4x6': { label: '10x15', width: 400, height: 600, kodak: { width: 409, height: 622 } },
  '6x8': { label: '15x20', width: 600, height: 800, kodak: { width: 622, height: 811 } },
};
// Drivers de impressão sem borda informam o papel com sobra: a Kodak 305 diz 409x622 para o 4x6.
const SIZE_TOLERANCE = 30;
const FRAME_DPI = 300;
const PREVIEW_DPI = 150;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function runScript(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
      { windowsHide: true, timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim()));
        resolve(stdout.replace(/^﻿/, '').trim());
      },
    );
  });
}

// Papel do driver com as medidas do tamanho pedido, em qualquer orientação.
// Várias opções da Kodak têm a mesma medida ("4 x 6 in", "2 x 6 in x 2", "6 x 8 in ... border"):
// vence a que começa com o tamanho, sem "x 2" (duas fotos por folha); depois, a de medida mais
// próxima; por fim, a de nome mais curto.
function findPaper(papers, size) {
  const close = (a, b) => Math.abs(a - b) <= SIZE_TOLERANCE;
  const [short, long] = [size.width / 100, size.height / 100];
  const named = new RegExp(`^\\s*(${short}\\s*x\\s*${long}|${long}\\s*x\\s*${short})\\b(?!.*\\bx\\s*2\\b)`, 'i');
  const rank = (p) => (named.test(p.name) ? 0 : 1);
  const distance = (p) => Math.abs(Math.min(p.width, p.height) - size.width) + Math.abs(Math.max(p.width, p.height) - size.height);
  return papers
    .filter((p) => close(Math.min(p.width, p.height), size.width) && close(Math.max(p.width, p.height), size.height))
    .sort((a, b) => rank(a) - rank(b) || distance(a) - distance(b) || a.name.length - b.name.length)[0] || null;
}

function pickPrinter(printers) {
  return printers.find((p) => /kodak/i.test(p.name) && /305/.test(p.name))
    || printers.find((p) => /305/.test(p.name))
    || null;
}

// Só guarda quando acha a Kodak: se ela estiver desligada, a próxima tentativa procura de novo.
let cached = null;
async function findPrinter({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < PRINTER_CACHE_MS) return cached;
  const printers = JSON.parse(await runScript(['-Mode', 'list']) || '[]');
  const result = { at: Date.now(), printer: pickPrinter(printers), printers };
  cached = result.printer ? result : null;
  return result;
}

// Gerada na primeira impressão e reaproveitada nas seguintes.
async function ensurePrintFile(row) {
  const printPath = path.join(DATA_DIR, row.path_display.replace(/-display\.jpg$/, '-print.jpg'));
  if (fs.existsSync(printPath)) return printPath;
  const tmpPath = `${printPath}.tmp`;
  await printVersion(path.join(DATA_DIR, row.path_original), tmpPath);
  await fsp.rename(tmpPath, printPath);
  return printPath;
}

// Molduras: uma pasta por desenho, com os 4 formatos dentro:
//   molduras/natal/10x15-horizontal.png, molduras/natal/15x20-vertical.png etc.
// A pasta "modelos" guarda os modelos para desenhar e não é uma moldura.
const FRAME_ID = /^[a-z0-9][a-z0-9-]*$/;

function framePath(frameId, size, orientation) {
  return path.join(FRAMES_DIR, frameId, `${size.label}-${orientation}.png`);
}

// Nome no balcão: o que estiver em molduras/<id>/nome.txt (para ter acento, ex.: "Calendário"),
// senão o nome da pasta: "neve-azul" → "Neve Azul".
function frameName(frameId) {
  try {
    const name = fs.readFileSync(path.join(FRAMES_DIR, frameId, 'nome.txt'), 'utf8').trim();
    if (name) return name;
  } catch {
    // sem nome.txt
  }
  return frameId.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function isFrame(frameId) {
  return typeof frameId === 'string' && FRAME_ID.test(frameId) && frameId !== 'modelos'
    && fs.existsSync(path.join(FRAMES_DIR, frameId));
}

// Molduras com pelo menos um formato, em ordem alfabética. Lido a cada chamada:
// uma pasta nova aparece no balcão sem reiniciar.
function listFrames() {
  let dirs;
  try {
    dirs = fs.readdirSync(FRAMES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return dirs
    .filter((dir) => dir.isDirectory() && isFrame(dir.name))
    .map((dir) => {
      const sizes = {};
      for (const [key, size] of Object.entries(SIZES)) {
        sizes[key] = {
          horizontal: fs.existsSync(framePath(dir.name, size, 'horizontal')),
          vertical: fs.existsSync(framePath(dir.name, size, 'vertical')),
        };
      }
      return { id: dir.name, name: frameName(dir.name), sizes };
    })
    .filter((frame) => Object.values(frame.sizes).some((s) => s.horizontal || s.vertical))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Foto com a moldura na proporção exata do papel (com a sobra), na resolução pedida.
// Como a proporção já é a da folha, o imprimir.ps1 não corta mais nada.
async function compose(file, frameId, size, paper, dpi, quality) {
  const orientation = await isLandscape(file) ? 'horizontal' : 'vertical';
  const frame = framePath(frameId, size, orientation);
  if (!fs.existsSync(frame)) {
    throw httpError(409, `A moldura ${frameName(frameId)} não tem a versão ${size.label} ${orientation}. Coloque o arquivo ${size.label}-${orientation}.png na pasta molduras/${frameId}.`);
  }
  const [short, long] = [Math.min(paper.width, paper.height), Math.max(paper.width, paper.height)]
    .map((hundredths) => Math.round((hundredths / 100) * dpi));
  const [width, height] = orientation === 'horizontal' ? [long, short] : [short, long];
  return framedVersion(file, frame, width, height, quality);
}

async function framedPrintFile(file, frameId, size, paper) {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const out = path.join(TMP_DIR, `moldura-${crypto.randomUUID()}.jpg`);
  await fsp.writeFile(out, await compose(file, frameId, size, paper, FRAME_DPI, 95));
  return out;
}

// Prévia de como a foto sai no papel, com moldura. Parte da versão display (já girada e
// leve), então não depende da impressora nem do Windows. Tira a sobra que a Kodak corta.
async function framedPreview(row, sizeKey, frameId) {
  const size = SIZES[sizeKey];
  const jpeg = await compose(path.join(DATA_DIR, row.path_display), frameId, size, size.kodak, PREVIEW_DPI, 90);
  const { width, height } = await sharp(jpeg).metadata();
  const scale = PREVIEW_DPI / 100;
  const [trimShort, trimLong] = [size.width * scale, size.height * scale].map(Math.round);
  const [trimW, trimH] = width > height ? [trimLong, trimShort] : [trimShort, trimLong];
  return sharp(jpeg)
    .extract({ left: Math.round((width - trimW) / 2), top: Math.round((height - trimH) / 2), width: trimW, height: trimH })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function print(row, sizeKey, frameId) {
  const size = SIZES[sizeKey];
  const { printer } = await findPrinter();
  if (!printer) throw httpError(503, 'Kodak 305 não encontrada. Confira se ela está ligada no USB e com o driver instalado.');
  const paper = findPaper(printer.papers, size);
  if (!paper) {
    const offered = printer.papers.map((p) => `${p.name} (${p.width}x${p.height})`).join(', ');
    console.error(`[impressão] nenhum papel ${size.label} na ${printer.name}; papéis do driver: ${offered}`);
    throw httpError(503, `O driver da ${printer.name} não oferece o papel ${size.label}.`);
  }

  const photoFile = await ensurePrintFile(row);
  const file = frameId ? await framedPrintFile(photoFile, frameId, size, paper) : photoFile;
  try {
    await runScript(['-Mode', 'print', '-Printer', printer.name, '-PaperIndex', String(paper.index), '-Image', file]);
  } catch (err) {
    cached = null;
    console.error(`[impressão] ${printer.name} recusou: ${err.message}`);
    throw httpError(502, 'A impressora recusou a foto. Confira se ela está ligada e com papel.');
  } finally {
    if (frameId) fsp.rm(file, { force: true }).catch(() => {});
  }
  return { printer: printer.name, paper: paper.name, size: size.label, frame: frameId ? frameName(frameId) : null };
}

// Uma impressão por vez, na ordem dos cliques.
let queue = Promise.resolve();
function printPhoto(row, sizeKey, frameId = null) {
  const job = queue.then(() => print(row, sizeKey, frameId));
  queue = job.catch(() => {});
  return job;
}

// O que o servidor enxerga: ajuda a conferir a instalação em /api/printer.
async function describe() {
  if (!SUPPORTED) return { supported: false };
  const { printer, printers } = await findPrinter({ fresh: true });
  const sizes = {};
  for (const [key, size] of Object.entries(SIZES)) {
    sizes[key] = { label: size.label, paper: printer ? findPaper(printer.papers, size)?.name || null : null };
  }
  return { supported: true, printer: printer?.name || null, sizes, papers: printer?.papers || [], printers: printers.map((p) => p.name) };
}

module.exports = { SUPPORTED, SIZES, printPhoto, describe, listFrames, isFrame, framedPrintFile, framedPreview, findPaper, pickPrinter };
