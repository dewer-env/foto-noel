import { connectRealtime } from '../shared/realtime.js';

// Tempos configuráveis pelo endereço: /vitrine/?novo=60&slide=6&horas=2
const params = new URLSearchParams(location.search);
function setting(name, fallback) {
  const value = Number(params.get(name));
  return value > 0 ? value : fallback;
}

const NEW_MS = setting('novo', 60) * 1000;      // a última foto fica na tela até o slideshow começar
const SLIDE_MS = setting('slide', 6) * 1000;    // cada foto do slideshow
const WINDOW_MS = setting('horas', 2) * 3600 * 1000; // histórico do slideshow
const MIN_NEW_MS = Math.min(2500, NEW_MS);      // foto nova, quando já há outra esperando

const SYNC_EVERY_MS = 60000;
const IMAGE_TIMEOUT_MS = 15000;
const RETRY_MS = 2000;
const FADE_MS = 700;
const MAX_MISSED = 5; // ao reconectar, só as mais recentes entram como "novas"
const CONN_NOTICE_MS = 3000;

const $ = (id) => document.getElementById(id);

const pool = new Map();     // fotos que podem aparecer: id → foto
const hiddenIds = new Set(); // ocultas: nunca entram, mesmo com uma resposta atrasada da API
let incoming = [];          // fotos novas esperando a vez
let deck = [];              // ordem embaralhada do slideshow
let current = null;         // foto na tela
let shownAt = 0;
let loaded = false;

/* ---------------- próxima foto ---------------- */

let timer = null;
let busy = false;
let rerun = false;

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(advance, ms);
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function takeNext() {
  const fresh = incoming.shift();
  if (fresh) return { ...fresh, isNew: true };
  if (!deck.length) deck = shuffle([...pool.values()]);
  if (deck.length > 1 && deck[0].id === current?.id) deck.push(deck.shift());
  const photo = deck.shift();
  return photo && { ...photo, isNew: false };
}

// Só uma troca por vez; pedidos no meio da troca são atendidos logo depois dela.
async function advance() {
  if (busy) { rerun = true; return; }
  busy = true;
  clearTimeout(timer);
  try {
    const next = takeNext();
    if (!next) {
      showIdle();
      schedule(SLIDE_MS);
      return;
    }
    if (next.id === current?.id && !next.isNew) { // só existe esta foto: ela fica
      current.isNew = false;
      schedule(SLIDE_MS);
      return;
    }
    const layer = await prepare(next);
    if (!layer || !pool.has(next.id)) { // não carregou, ou foi ocultada enquanto carregava
      schedule(RETRY_MS);
      return;
    }
    swap(layer);
    current = next;
    shownAt = Date.now();
    schedule(next.isNew ? (incoming.length ? MIN_NEW_MS : NEW_MS) : SLIDE_MS);
  } finally {
    busy = false;
    if (rerun) { rerun = false; advance(); }
  }
}

// Decide se a mudança pede uma troca agora: uma foto nova tira o slideshow da tela na
// hora, mas outra foto nova ainda fica um mínimo de tempo para dar para ver.
function nudge() {
  if (!incoming.length && (current || !pool.size)) return;
  const elapsed = Date.now() - shownAt;
  if (current?.isNew && incoming.length && elapsed < MIN_NEW_MS) schedule(MIN_NEW_MS - elapsed);
  else advance();
}

/* ---------------- tela ---------------- */

// Carrega a imagem por inteiro antes de ela entrar em cena, para não "piscar".
// O tempo limite evita que um carregamento travado congele a vitrine.
async function prepare(photo) {
  const img = new Image();
  img.alt = '';
  const loading = new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    setTimeout(reject, IMAGE_TIMEOUT_MS);
  });
  img.src = `/api/photos/${photo.id}/display`;
  try {
    await loading;
    await img.decode().catch(() => {});
  } catch {
    img.removeAttribute('src');
    return null;
  }

  const layer = document.createElement('div');
  layer.className = photo.isNew ? 'layer new' : 'layer';
  const caption = document.createElement('div');
  caption.className = 'caption';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Família';
  const code = document.createElement('span');
  code.className = 'code';
  code.textContent = photo.code;
  caption.append(label, code);
  layer.append(img, caption);
  return layer;
}

function removeLayers(layers) {
  setTimeout(() => {
    for (const old of layers) {
      old.querySelector('img')?.removeAttribute('src'); // devolve a memória mais cedo no Safari
      old.remove();
    }
  }, FADE_MS);
}

function swap(layer) {
  const stage = $('stage');
  const old = [...stage.children];
  stage.append(layer);
  void layer.offsetWidth; // aplica o estado inicial para a transição acontecer
  layer.classList.add('on');
  for (const previous of old) previous.classList.remove('on'); // sem fundo opaco, a anterior precisa sumir aos poucos
  $('idle').classList.add('off');
  removeLayers(old);
}

function showIdle() {
  const stage = $('stage');
  $('idle').classList.remove('off');
  for (const layer of stage.children) layer.classList.remove('on');
  removeLayers([...stage.children]);
  current = null;
}

/* ---------------- fotos ---------------- */

function forget(id) {
  pool.delete(id);
  incoming = incoming.filter((p) => p.id !== id);
  deck = deck.filter((p) => p.id !== id);
}

function hide(id) {
  hiddenIds.add(id);
  forget(id);
  if (current?.id === id) advance(); // sai da tela na hora (pedido do cliente / LGPD)
}

// Busca as fotos recentes: carrega no início, recupera o que passou durante uma queda e
// tira do slideshow o que saiu da janela de tempo. Pede as últimas N em vez de usar
// `since` porque, com limite, `since` devolveria as mais antigas do período.
let syncing = false;
async function syncPhotos({ announce = true } = {}) {
  if (syncing) return;
  syncing = true;
  try {
    const ctrl = new AbortController();
    const abort = setTimeout(() => ctrl.abort(), 8000);
    let photos;
    try {
      const res = await fetch('/api/photos?limit=500', { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) return;
      photos = await res.json();
    } finally {
      clearTimeout(abort);
    }

    const cutoff = Date.now() - WINDOW_MS;
    const missed = [];
    let latest = null;
    for (const photo of photos) {
      if (photo.hiddenFromDisplay) { hide(photo.id); continue; }
      if (hiddenIds.has(photo.id) || new Date(photo.createdAt).getTime() < cutoff) continue;
      if (loaded && announce && !pool.has(photo.id)) missed.push(photo);
      pool.set(photo.id, photo);
      latest = photo; // a API devolve em ordem cronológica
    }
    for (const [id, photo] of pool) {
      if (new Date(photo.createdAt).getTime() < cutoff) forget(id);
    }
    incoming.push(...missed.slice(-MAX_MISSED));
    if (!loaded && latest && !incoming.length) incoming.push(latest); // ao abrir, começa pela última foto
    loaded = true;
    nudge();
  } catch {
    // sem conexão: continua mostrando o que já tem e tenta de novo depois
  } finally {
    syncing = false;
  }
}

function onEvent(event) {
  if (event.type === 'photo.created') {
    const { id, sessionId, code } = event.photo;
    if (pool.has(id) || hiddenIds.has(id)) return;
    const photo = { id, sessionId, code, createdAt: new Date().toISOString() };
    pool.set(id, photo);
    incoming.push(photo);
    nudge();
  }
  if (event.type === 'photo.updated') {
    if (event.photo.hiddenFromDisplay) {
      hide(event.photo.id);
    } else {
      hiddenIds.delete(event.photo.id);
      syncPhotos({ announce: false }); // voltou ao slideshow, sem aparecer como foto nova
    }
  }
}

/* ---------------- conexão ---------------- */

let connTimer = null;

function onOpen() {
  clearTimeout(connTimer);
  connTimer = null;
  $('conn').hidden = true;
  syncPhotos();
}

// Aviso só depois de alguns segundos, para uma oscilação rápida não aparecer para o público.
function onClose() {
  connTimer ??= setTimeout(() => { $('conn').hidden = false; }, CONN_NOTICE_MS);
}

/* ---------------- tela sempre ligada ---------------- */

// Em http o iPad não oferece Wake Lock: lá vale o ajuste "Bloqueio Automático: Nunca".
async function keepAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  keepAwake();
  syncPhotos();
});

/* ---------------- início ---------------- */

keepAwake();
connectRealtime({ onEvent, onOpen, onClose });
setInterval(syncPhotos, SYNC_EVERY_MS); // também cobre um WebSocket morto que não avisou
schedule(SLIDE_MS);
