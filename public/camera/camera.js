import { queue } from './queue.js';
import { uuid } from '../shared/uuid.js';
import { connectRealtime } from '../shared/realtime.js';

const HEALTH_EVERY_MS = 5000;
const UPLOAD_TIMEOUT_MS = 60000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;
const SESSION_KEY = 'papainoel.session';
const RECENT_PHOTOS = 12; // o suficiente para a largura da tela; o CSS esconde as que não couberem

const $ = (id) => document.getElementById(id);

const state = {
  session: loadCachedSession(), // { id, code }
  online: false,
  sending: false,
  items: [],         // cópia da fila do IndexedDB
  serverPhotos: [],  // fotos da família atual já no servidor
  lastSentAt: null,
};

/* ---------------- família ---------------- */

function loadCachedSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function setSession(session) {
  if (!session) return;
  const changed = state.session?.id !== session.id;
  state.session = { id: session.id, code: session.code };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(state.session)); } catch {}
  if (changed) {
    state.serverPhotos = [];
    loadServerPhotos();
  }
  render();
}

async function loadSession() {
  try { setSession(await getJSON('/api/sessions/current')); } catch {}
}

async function newFamily() {
  if (!state.online) return toast('Sem conexão com o servidor. Espere voltar para criar nova família.');
  const code = state.session?.code;
  if (!confirm(`Encerrar a família ${code ?? ''} e começar uma nova?`)) return;
  try {
    const res = await fetchWithTimeout('/api/sessions', { method: 'POST' }, 5000);
    if (!res.ok) throw new Error();
    setSession(await res.json());
    toast(`Família ${state.session.code} começou`);
  } catch {
    toast('Não foi possível criar a família. Tente de novo.');
  }
}

/* ---------------- tirar foto → fila ---------------- */

async function addFiles(files) {
  if (!files.length) return;
  if (!state.session) return toast('Ainda não há família definida. Espere conectar ao servidor.');

  for (const file of files) {
    await queue.put({
      clientPhotoId: uuid(),
      sessionId: state.session.id,
      code: state.session.code,
      createdAt: Date.now(),
      type: file.type || 'image/jpeg',
      name: file.name || 'foto.jpg',
      data: await file.arrayBuffer(),
      error: null,
    });
  }
  await refreshQueue();
  kick();
}

/* ---------------- envio com novas tentativas ---------------- */

let retryTimer = null;
let retryDelay = RETRY_MIN_MS;

// Começa (ou recomeça já) a esvaziar a fila.
function kick() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!state.sending) drain();
}

async function drain() {
  state.sending = true;
  render();
  try {
    for (;;) {
      const next = (await queue.all()).find((i) => !i.error);
      if (!next) { retryDelay = RETRY_MIN_MS; break; }

      const result = await upload(next);
      if (result.ok) {
        await queue.remove(next.clientPhotoId);
        state.lastSentAt = Date.now();
        retryDelay = RETRY_MIN_MS;
        setOnline(true);
        if (next.sessionId === state.session?.id) loadServerPhotos();
      } else if (result.error) {
        // Recusa definitiva (ex.: imagem ilegível): não adianta repetir sozinho.
        await queue.put({ ...next, error: result.error });
      } else {
        // Rede ou servidor fora: tenta de novo daqui a pouco, cada vez esperando mais.
        retryTimer = setTimeout(kick, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        break;
      }
      await refreshQueue();
    }
  } finally {
    state.sending = false;
    await refreshQueue();
  }
}

async function upload(item) {
  const form = new FormData();
  form.append('sessionId', item.sessionId);
  form.append('clientPhotoId', item.clientPhotoId);
  form.append('file', new Blob([item.data], { type: item.type }), item.name);

  try {
    const res = await fetchWithTimeout('/api/photos', { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS);
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
    return permanent ? { error: body.error || `Erro ${res.status}` } : {};
  } catch {
    setOnline(false);
    return {};
  }
}

async function retryFailed(clientPhotoId) {
  const item = state.items.find((i) => i.clientPhotoId === clientPhotoId);
  if (!item) return;
  await queue.put({ ...item, error: null });
  await refreshQueue();
  kick();
}

async function discardFailed(clientPhotoId) {
  if (!confirm('Descartar esta foto do iPhone? Ela não foi recebida pelo servidor.')) return;
  await queue.remove(clientPhotoId);
  await refreshQueue();
}

/* ---------------- conexão ---------------- */

function setOnline(online) {
  if (online === state.online) return;
  state.online = online;
  if (online) {
    loadSession();
    loadServerPhotos();
    kick();
  }
  render();
}

async function checkHealth() {
  try {
    const res = await fetchWithTimeout('/api/health', { cache: 'no-store' }, 3000);
    setOnline(res.ok);
  } catch {
    setOnline(false);
  }
}

function onEvent(event) {
  if (event.type === 'session.created') setSession(event.session);
  if (event.type === 'photo.created' && event.photo.sessionId === state.session?.id) loadServerPhotos();
}

/* ---------------- fotos da família ---------------- */

let photosRequest = 0;
async function loadServerPhotos() {
  if (!state.session) return;
  const sessionId = state.session.id;
  const request = ++photosRequest;
  try {
    const photos = await getJSON(`/api/photos?sessionId=${encodeURIComponent(sessionId)}&limit=200`);
    if (request !== photosRequest || sessionId !== state.session?.id) return; // resposta atrasada
    state.serverPhotos = photos;
    render();
  } catch {}
}

// URLs locais (blob:) para mostrar as fotos que ainda só existem no iPhone.
const localUrls = new Map();
function localUrl(item) {
  if (!localUrls.has(item.clientPhotoId)) {
    localUrls.set(item.clientPhotoId, URL.createObjectURL(new Blob([item.data], { type: item.type })));
  }
  return localUrls.get(item.clientPhotoId);
}

async function refreshQueue() {
  state.items = await queue.all();
  const alive = new Set(state.items.map((i) => i.clientPhotoId));
  for (const [id, url] of localUrls) {
    if (!alive.has(id)) { URL.revokeObjectURL(url); localUrls.delete(id); }
  }
  render();
}

/* ---------------- tela ---------------- */

function render() {
  const pending = state.items.filter((i) => !i.error);
  const failed = state.items.filter((i) => i.error);

  $('status').dataset.state = !state.online ? 'offline' : (state.sending && pending.length ? 'sending' : 'online');
  $('statusText').textContent = state.online ? 'Conectado' : 'Sem conexão';
  $('deliveryText').textContent = deliveryText(pending.length);
  renderLastSent();

  $('code').textContent = state.session?.code ?? '–';
  $('newFamily').disabled = !state.online;

  // quantas fotos a família tem, contando as que ainda estão na fila
  const onServer = new Set(state.serverPhotos.map((p) => p.clientPhotoId));
  const queued = pending.filter((i) => i.sessionId === state.session?.id && !onServer.has(i.clientPhotoId));
  $('photoCount').textContent = plural(state.serverPhotos.length + queued.length, 'foto', 'fotos');

  // últimas fotos da família, a mais nova primeiro
  renderTiles([
    ...[...queued].reverse().map((i) => ({ key: `q:${i.clientPhotoId}`, src: localUrl(i), pending: true })),
    ...[...state.serverPhotos].reverse().map((p) => ({ key: `s:${p.id}`, src: `/api/photos/${p.id}/thumb`, pending: false })),
  ].slice(0, RECENT_PHOTOS));

  // fotos com erro
  $('failedOpen').hidden = failed.length === 0;
  $('failedOpen').textContent = `⚠️ ${plural(failed.length, 'erro', 'erros')}`;
  if (!failed.length) $('failed').hidden = true;
  $('failedList').replaceChildren(...failed.map((item) => {
    const li = document.createElement('li');
    li.innerHTML = `<img alt=""><span class="msg"></span><button data-act="retry">Tentar</button><button data-act="discard">Descartar</button>`;
    li.querySelector('img').src = localUrl(item);
    li.querySelector('.msg').textContent = `Família ${item.code}: ${item.error}`;
    li.querySelector('[data-act="retry"]').onclick = () => retryFailed(item.clientPhotoId);
    li.querySelector('[data-act="discard"]').onclick = () => discardFailed(item.clientPhotoId);
    return li;
  }));
}

// Reaproveita os elementos já na tela para as imagens não piscarem a cada atualização.
function renderTiles(tiles) {
  const container = $('thumbs');
  const existing = new Map([...container.children].map((el) => [el.dataset.key, el]));
  const nodes = tiles.map((t) => {
    let el = existing.get(t.key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'thumb';
      el.dataset.key = t.key;
      el.innerHTML = '<img alt="" decoding="async"><span class="badge"></span>';
      el.querySelector('img').src = t.src;
    }
    el.classList.toggle('pending', t.pending);
    const badge = el.querySelector('.badge');
    badge.textContent = t.pending ? '⏳' : '✓';
    badge.classList.toggle('sent', !t.pending);
    return el;
  });
  while (nodes.length < RECENT_PHOTOS) { // espaços vazios mantêm o layout desde a primeira foto
    const empty = document.createElement('div');
    empty.className = 'thumb';
    nodes.push(empty);
  }
  container.replaceChildren(...nodes);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// A resposta que o fotógrafo procura: as fotos chegaram?
function deliveryText(pending) {
  if (!pending) return state.lastSentAt ? '✓ Tudo enviado' : 'Nenhuma foto na fila';
  const photos = plural(pending, 'foto', 'fotos');
  return state.online ? `⏳ Enviando ${photos}…` : `📥 ${photos} no iPhone, enviam quando voltar`;
}

function renderLastSent() {
  if (!state.lastSentAt) { $('lastText').textContent = ''; return; }
  const s = Math.round((Date.now() - state.lastSentAt) / 1000);
  $('lastText').textContent = s < 60 ? `última há ${s} s` : `última há ${Math.floor(s / 60)} min`;
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ---------------- utilitários ---------------- */

async function fetchWithTimeout(url, options = {}, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getJSON(url) {
  const res = await fetchWithTimeout(url, { cache: 'no-store' }, 5000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------------- início ---------------- */

$('cameraInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = ''; // permite escolher a mesma foto de novo
  try {
    await addFiles(files);
  } catch (err) {
    toast('Não foi possível guardar a foto no iPhone.');
    console.error(err);
  }
});
$('newFamily').addEventListener('click', newFamily);
$('failedOpen').addEventListener('click', () => { $('failed').hidden = false; });
$('failedClose').addEventListener('click', () => { $('failed').hidden = true; });

// Ao voltar do segundo plano (o iOS congela a página), confere tudo na hora.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { checkHealth(); kick(); }
});
window.addEventListener('online', () => { checkHealth(); kick(); });

// Avisa antes de fechar/recarregar se ainda houver foto na fila.
window.addEventListener('beforeunload', (e) => {
  if (state.items.length) e.preventDefault();
});

// Pede ao navegador para não apagar a fila quando faltar espaço.
navigator.storage?.persist?.().catch(() => {});

connectRealtime({ onEvent, onOpen: () => setOnline(true) });
setInterval(checkHealth, HEALTH_EVERY_MS);
setInterval(renderLastSent, 1000);

render();
await refreshQueue();
checkHealth();
kick();
