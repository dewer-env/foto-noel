// Mantém o servidor no ar durante o evento: reinicia se ele cair ou travar, grava os
// logs em arquivo, impede o computador de dormir e abre o balcão no navegador.
// Uso: npm run iniciar (ou os arquivos de dois cliques na raiz do projeto).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { ROOT, PORT, DATA_DIR, localDay } = require('../server/config');

const LOG_DIR = path.join(DATA_DIR, 'logs');
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const BALCAO_URL = `http://localhost:${PORT}/balcao/`;

const RESTART_MIN_MS = 2000;
const RESTART_MAX_MS = 30000;
const STABLE_AFTER_MS = 60000;   // ficou no ar esse tempo: a próxima queda reinicia rápido de novo
const WATCH_EVERY_MS = 10000;
const WATCH_MAX_FAILURES = 3;    // sem resposta por ~30 s: considera travado
const STOP_TIMEOUT_MS = 4000;

let child = null;
let stopping = false;
let restartDelay = RESTART_MIN_MS;
let startedAt = 0;
let healthySinceStart = false;
let healthFailures = 0;
let browserOpened = false;
let keepAwakeProcess = null;

/* ---------------- logs ---------------- */

fs.mkdirSync(LOG_DIR, { recursive: true });

function writeLine(line) {
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, `${localDay()}.log`), `${new Date().toISOString()} ${line}\n`);
  } catch (err) {
    console.error(`[supervisor] não foi possível gravar o log: ${err.message}`);
  }
}

const log = (message) => writeLine(`[supervisor] ${message}`);

/* ---------------- servidor ---------------- */

async function isHealthy() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function startServer() {
  startedAt = Date.now();
  healthySinceStart = false;
  healthFailures = 0;
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  readline.createInterface({ input: child.stdout }).on('line', writeLine);
  readline.createInterface({ input: child.stderr }).on('line', writeLine);
  child.on('error', (err) => log(`não foi possível iniciar o servidor: ${err.message}`));
  child.on('exit', onServerExit);
}

function onServerExit(code, signal) {
  child = null;
  if (stopping) { process.exit(0); }
  restartDelay = Date.now() - startedAt > STABLE_AFTER_MS
    ? RESTART_MIN_MS
    : Math.min(restartDelay * 2, RESTART_MAX_MS);
  log(`servidor parou (${signal || `código ${code}`}); reiniciando em ${Math.round(restartDelay / 1000)} s`);
  setTimeout(startServer, restartDelay);
}

async function watch() {
  if (!child || stopping) return;
  const server = child;
  const healthy = await isHealthy();
  if (server !== child) return; // reiniciou enquanto esperava a resposta
  if (healthy) {
    healthySinceStart = true;
    healthFailures = 0;
    openBrowser();
    return;
  }
  if (!healthySinceStart) return; // ainda subindo
  healthFailures += 1;
  if (healthFailures >= WATCH_MAX_FAILURES) {
    log('servidor não responde; encerrando para reiniciar');
    server.kill('SIGKILL');
  }
}

/* ---------------- computador acordado ---------------- */

function keepAwake() {
  try {
    if (process.platform === 'darwin') {
      keepAwakeProcess = spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      // 2147483651 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
      const script = `
        $t = Add-Type -Name Power -Namespace Noel -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);';
        while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {
          [void]$t::SetThreadExecutionState([uint32]2147483651);
          Start-Sleep -Seconds 30;
        }`;
      keepAwakeProcess = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
    } else {
      return;
    }
    keepAwakeProcess.on('error', (err) => log(`não foi possível impedir o computador de dormir: ${err.message}`));
    log('computador impedido de dormir enquanto o servidor estiver no ar');
  } catch (err) {
    log(`não foi possível impedir o computador de dormir: ${err.message}`);
  }
}

/* ---------------- navegador ---------------- */

function openBrowser() {
  if (browserOpened || process.env.PAPAINOEL_SEM_NAVEGADOR) return;
  browserOpened = true;
  const command = process.platform === 'darwin' ? ['open', [BALCAO_URL]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', BALCAO_URL]]
    : null;
  if (!command) return;
  spawn(command[0], command[1], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
}

/* ---------------- encerramento ---------------- */

function stop() {
  if (stopping) return;
  stopping = true;
  log('encerrando');
  if (!child) process.exit(0);
  child.kill('SIGTERM');
  setTimeout(() => { child?.kill('SIGKILL'); process.exit(0); }, STOP_TIMEOUT_MS).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop); // janela do terminal fechada
process.on('exit', () => keepAwakeProcess?.kill());

/* ---------------- início ---------------- */

(async () => {
  // Dois cliques de novo com tudo já no ar: só abre o balcão.
  if (await isHealthy()) {
    console.log(`O servidor já está rodando na porta ${PORT}.`);
    openBrowser();
    return;
  }
  log(`iniciando; logs em ${LOG_DIR}`);
  keepAwake();
  startServer();
  setInterval(watch, WATCH_EVERY_MS);
  setTimeout(watch, 1500);
})();
