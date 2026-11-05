// Impressão direta na Kodak 305, sem diálogo. Por enquanto só no Windows: o
// servidor chama o imprimir.ps1, que usa a impressão nativa do sistema.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { DATA_DIR } = require('./config');
const { printVersion } = require('./images');

const SUPPORTED = process.platform === 'win32';
const SCRIPT = path.join(__dirname, 'imprimir.ps1');
const SCRIPT_TIMEOUT_MS = 60000;
const PRINTER_CACHE_MS = 5 * 60 * 1000;

// Medidas em centésimos de polegada, a unidade em que o Windows informa os papéis.
const SIZES = {
  '4x6': { label: '10x15', width: 400, height: 600 },
  '6x8': { label: '15x20', width: 600, height: 800 },
};
const SIZE_TOLERANCE = 10;

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
// Se houver mais de um (ex.: "6x8" e uma variante), fica com o de nome mais curto.
function findPaper(papers, size) {
  const close = (a, b) => Math.abs(a - b) <= SIZE_TOLERANCE;
  return papers
    .filter((p) => close(Math.min(p.width, p.height), size.width) && close(Math.max(p.width, p.height), size.height))
    .sort((a, b) => a.name.length - b.name.length)[0] || null;
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

async function print(row, sizeKey) {
  const size = SIZES[sizeKey];
  const { printer } = await findPrinter();
  if (!printer) throw httpError(503, 'Kodak 305 não encontrada. Confira se ela está ligada no USB e com o driver instalado.');
  const paper = findPaper(printer.papers, size);
  if (!paper) throw httpError(503, `O driver da ${printer.name} não oferece o papel ${size.label}.`);

  const file = await ensurePrintFile(row);
  try {
    await runScript(['-Mode', 'print', '-Printer', printer.name, '-PaperIndex', String(paper.index), '-Image', file]);
  } catch (err) {
    cached = null;
    console.error(`[impressão] ${printer.name} recusou: ${err.message}`);
    throw httpError(502, 'A impressora recusou a foto. Confira se ela está ligada e com papel.');
  }
  return { printer: printer.name, paper: paper.name, size: size.label };
}

// Uma impressão por vez, na ordem dos cliques.
let queue = Promise.resolve();
function printPhoto(row, sizeKey) {
  const job = queue.then(() => print(row, sizeKey));
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
  return { supported: true, printer: printer?.name || null, sizes, printers: printers.map((p) => p.name) };
}

module.exports = { SUPPORTED, SIZES, printPhoto, describe, findPaper, pickPrinter };
