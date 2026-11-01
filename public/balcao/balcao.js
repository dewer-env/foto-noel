import { connectRealtime } from '../shared/realtime.js';

const SYNC_EVERY_MS = 60000;
const FRESH_MS = 2500;
const DAY_LIMIT = 5000;

const $ = (id) => document.getElementById(id);

const state = {
  day: localDay(),
  followToday: true,  // na virada do dia, passa sozinho para o dia novo
  photos: new Map(),  // id → foto do dia escolhido
  query: '',          // código buscado
  viewerId: null,     // foto ampliada
  online: false,
  loaded: false,
  loadFailed: false,
  hiding: false,
};

function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ---------------- dados ---------------- */

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Busca o dia inteiro: ao abrir, ao reconectar e a cada minuto, para cobrir qualquer evento perdido.
let loadRequest = 0;
async function loadDay() {
  const request = ++loadRequest;
  try {
    const photos = await getJSON(`/api/photos?day=${state.day}&limit=${DAY_LIMIT}`);
    if (request !== loadRequest) return; // o dia mudou enquanto carregava
    for (const photo of photos) state.photos.set(photo.id, photo);
    state.loaded = true;
    state.loadFailed = false;
  } catch {
    if (request !== loadRequest) return;
    state.loadFailed = true;
  }
  render();
}

function setDay(day) {
  state.day = day;
  state.followToday = day === localDay();
  state.photos.clear();
  tileNodes.clear();
  familyNodes.clear();
  state.loaded = false;
  closeViewer();
  render();
  loadDay();
}

async function onPhotoCreated(id) {
  try {
    const photo = await getJSON(`/api/photos/${encodeURIComponent(id)}`);
    if (photo.day !== state.day) return;
    const isNew = !state.photos.has(photo.id);
    state.photos.set(photo.id, photo);
    render();
    if (isNew) flash(photo.id);
  } catch {
    // a próxima busca do dia traz esta foto
  }
}

function onEvent(event) {
  if (event.type === 'photo.created') onPhotoCreated(event.photo.id);
  if (event.type === 'photo.updated') {
    const photo = state.photos.get(event.photo.id);
    if (!photo) return;
    photo.hiddenFromDisplay = event.photo.hiddenFromDisplay;
    render();
  }
}

async function toggleHidden() {
  const photo = state.photos.get(state.viewerId);
  if (!photo || state.hiding) return;
  state.hiding = true;
  renderViewer();
  try {
    const res = await fetch(`/api/photos/${encodeURIComponent(photo.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenFromDisplay: !photo.hiddenFromDisplay }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    photo.hiddenFromDisplay = (await res.json()).hiddenFromDisplay;
  } catch {
    toast('Não foi possível alterar. Confira a conexão e tente de novo.');
  } finally {
    state.hiding = false;
    render();
  }
}

/* ---------------- lista ---------------- */

const tileNodes = new Map();   // id → elemento, para as imagens não recarregarem a cada atualização
const familyNodes = new Map(); // sessionId → elementos do grupo

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatDay(day) {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

// Famílias do dia, a mais nova primeiro; dentro de cada uma, as fotos em ordem de captura.
function groupFamilies() {
  const groups = new Map();
  for (const photo of state.photos.values()) {
    if (!groups.has(photo.sessionId)) groups.set(photo.sessionId, { id: photo.sessionId, code: photo.code, photos: [] });
    groups.get(photo.sessionId).photos.push(photo);
  }
  const families = [...groups.values()].sort((a, b) => b.code - a.code);
  for (const family of families) family.photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return families;
}

function visibleFamilies(families) {
  if (!state.query) return families;
  const code = Number(state.query);
  return families.filter((family) => family.code === code);
}

function tileFor(photo) {
  let tile = tileNodes.get(photo.id);
  if (!tile) {
    tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = `/api/photos/${photo.id}/thumb`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Oculta da vitrine';
    tile.append(img, badge);
    tile.addEventListener('click', () => openViewer(photo.id));
    tileNodes.set(photo.id, tile);
  }
  tile.classList.toggle('is-hidden', photo.hiddenFromDisplay);
  tile.querySelector('.badge').hidden = !photo.hiddenFromDisplay;
  tile.setAttribute('aria-label', `Ampliar foto da família ${photo.code}, ${formatTime(photo.createdAt)}`);
  return tile;
}

function familyFor(family) {
  let node = familyNodes.get(family.id);
  if (!node) {
    const section = document.createElement('section');
    section.className = 'family';
    const head = document.createElement('div');
    head.className = 'family-head';
    const label = document.createElement('div');
    label.className = 'family-label';
    label.textContent = 'FAMÍLIA';
    const code = document.createElement('div');
    code.className = 'family-code';
    code.textContent = family.code;
    const meta = document.createElement('div');
    meta.className = 'family-meta';
    head.append(label, code, meta);
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    section.append(head, tiles);
    node = { section, meta, tiles };
    familyNodes.set(family.id, node);
  }
  const last = family.photos[family.photos.length - 1];
  node.meta.textContent = `${plural(family.photos.length, 'foto', 'fotos')} · ${formatTime(last.createdAt)}`;
  node.tiles.replaceChildren(...family.photos.map(tileFor));
  return node.section;
}

function emptyMessage(families) {
  if (families.length) return '';
  if (state.loadFailed) return 'Não foi possível carregar as fotos. Tentando de novo…';
  if (!state.loaded) return 'Carregando…';
  if (state.query) return `Nenhuma foto da família ${Number(state.query)} em ${formatDay(state.day)}.`;
  return `Nenhuma foto em ${formatDay(state.day)}.`;
}

function render() {
  const families = groupFamilies();
  const visible = visibleFamilies(families);

  $('families').replaceChildren(...visible.map(familyFor));
  const message = emptyMessage(visible);
  $('empty').textContent = message;
  $('empty').hidden = !message;

  $('summary').textContent = `${plural(families.length, 'família', 'famílias')} · ${plural(state.photos.size, 'foto', 'fotos')}`;
  $('conn').dataset.online = state.online;
  $('connText').textContent = state.online ? 'Conectado' : 'Sem conexão, tentando de novo…';
  renderViewer();
}

function flash(id) {
  const tile = tileNodes.get(id);
  if (!tile) return;
  tile.classList.add('fresh');
  setTimeout(() => tile.classList.remove('fresh'), FRESH_MS);
}

/* ---------------- foto ampliada ---------------- */

let viewerReturnFocus = null;
let viewerShownId = null;

function viewerPhotos() {
  return visibleFamilies(groupFamilies()).flatMap((family) => family.photos);
}

function openViewer(id) {
  viewerReturnFocus = document.activeElement;
  state.viewerId = id;
  renderViewer();
  $('viewerClose').focus();
}

function closeViewer() {
  if (!state.viewerId) return;
  state.viewerId = null;
  viewerShownId = null;
  renderViewer();
  $('viewerImage').removeAttribute('src');
  if (viewerReturnFocus?.isConnected) viewerReturnFocus.focus();
  else $('search').focus();
}

function step(delta) {
  const photos = viewerPhotos();
  const next = photos[photos.findIndex((p) => p.id === state.viewerId) + delta];
  if (next) { state.viewerId = next.id; renderViewer(); }
}

function renderViewer() {
  const photo = state.viewerId && state.photos.get(state.viewerId);
  $('viewer').hidden = !photo;
  if (!photo) return;

  if (viewerShownId !== photo.id) {
    viewerShownId = photo.id;
    // Tira a imagem anterior antes, para nunca aparecer uma foto com os dados de outra.
    $('viewerImage').removeAttribute('src');
    $('viewerImage').src = `/api/photos/${photo.id}/display`;
    $('viewerImage').alt = `Foto da família ${photo.code}`;
    $('viewerOriginal').href = `/api/photos/${photo.id}/original`;
  }

  const photos = viewerPhotos();
  const index = photos.findIndex((p) => p.id === photo.id);
  $('viewerCode').textContent = photo.code;
  $('viewerInfo').textContent = `${formatTime(photo.createdAt)} · foto ${index + 1} de ${photos.length}`;
  $('viewerPrev').disabled = index <= 0;
  $('viewerNext').disabled = index < 0 || index >= photos.length - 1;

  $('viewerVisibility').textContent = photo.hiddenFromDisplay ? 'Oculta da vitrine' : 'Visível na vitrine';
  $('viewerVisibility').classList.toggle('is-hidden', photo.hiddenFromDisplay);
  $('viewerHide').textContent = photo.hiddenFromDisplay ? 'Mostrar na vitrine' : 'Ocultar da vitrine';
  $('viewerHide').disabled = state.hiding;
}

/* ---------------- aviso ---------------- */

let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

/* ---------------- início ---------------- */

$('search').addEventListener('input', (e) => {
  const digits = e.target.value.replace(/\D/g, '');
  if (digits !== e.target.value) e.target.value = digits;
  state.query = digits;
  render();
});

$('day').value = state.day;
$('day').addEventListener('change', (e) => {
  if (e.target.value) setDay(e.target.value);
  else e.target.value = state.day;
});

$('viewerClose').addEventListener('click', closeViewer);
$('viewerHide').addEventListener('click', toggleHidden);
$('viewerPrev').addEventListener('click', () => step(-1));
$('viewerNext').addEventListener('click', () => step(1));
$('viewerBody').addEventListener('click', (e) => {
  if (e.target === e.currentTarget || e.target === $('viewerImage')) closeViewer();
});

document.addEventListener('keydown', (e) => {
  if (state.viewerId) {
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
    return;
  }
  if (e.key === 'Escape' && state.query) {
    $('search').value = '';
    state.query = '';
    render();
    $('search').focus();
    return;
  }
  // Digitar um número em qualquer lugar já vai para a busca.
  const typing = e.target instanceof HTMLInputElement;
  if (!typing && /^\d$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) $('search').focus();
});

connectRealtime({
  onEvent,
  onOpen: () => { state.online = true; render(); loadDay(); },
  onClose: () => { state.online = false; render(); },
});

setInterval(() => {
  const today = localDay();
  if (state.followToday && state.day !== today) {
    $('day').value = today;
    setDay(today);
  } else {
    loadDay();
  }
}, SYNC_EVERY_MS);

render();
loadDay();
