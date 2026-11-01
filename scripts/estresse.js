// Teste de estresse: envia muitas fotos como o iPhone faz, com novas tentativas e reenvios,
// e no fim confere se nenhuma se perdeu ou duplicou. Durante o teste, dá para derrubar o
// Wi-Fi ou reiniciar o servidor: as fotos pendentes são reenviadas.
// Uso: npm run estresse                (300 fotos em http://localhost:3000)
//      node scripts/estresse.js 500 http://192.168.0.10:3000
const crypto = require('node:crypto');
const sharp = require('sharp');

const COUNT = Number(process.argv[2]) || 300;
const BASE = (process.argv[3] || 'http://localhost:3000').replace(/\/$/, '');
const DUPLICATE_EVERY = 10;        // a cada 10 fotos, reenvia uma como se a resposta tivesse se perdido
const RETRY_MS = 1000;
const GIVE_UP_MS = 10 * 60 * 1000; // desiste de uma foto depois de 10 min sem conseguir enviar
const REQUEST_TIMEOUT_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let retries = 0;

// Repete até conseguir enquanto o problema for de rede ou do servidor (5xx).
async function request(path, options = {}) {
  const giveUpAt = Date.now() + GIVE_UP_MS;
  for (;;) {
    try {
      const res = await fetch(BASE + path, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.status < 500) return res;
    } catch {
      // servidor fora do ar ou rede caída
    }
    if (Date.now() > giveUpAt) throw new Error(`sem resposta do servidor em ${path}`);
    retries += 1;
    process.stdout.write('!');
    await sleep(RETRY_MS);
  }
}

async function upload(jpeg, sessionId, clientPhotoId) {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('clientPhotoId', clientPhotoId);
  form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'estresse.jpg');
  const res = await request('/api/photos', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`foto recusada: HTTP ${res.status}`);
  return (await res.json()).id;
}

(async () => {
  console.log('Gerando a imagem de teste (12 MP)…');
  const jpeg = await sharp({
    create: { width: 4032, height: 3024, channels: 3, background: '#777777', noise: { type: 'gaussian', mean: 128, sigma: 25 } },
  }).jpeg({ quality: 60 }).toBuffer();

  const session = await (await request('/api/sessions', { method: 'POST' })).json();
  console.log(`Família ${session.code}: enviando ${COUNT} fotos de ${(jpeg.length / 1048576).toFixed(1)} MB para ${BASE}`);
  console.log('Cada "." é uma foto enviada; cada "!" é uma nova tentativa.\n');

  const startedAt = Date.now();
  const sent = new Map(); // clientPhotoId → id devolvido pelo servidor
  let wrongDuplicates = 0;
  let duplicatesSent = 0;

  for (let i = 1; i <= COUNT; i++) {
    const clientPhotoId = crypto.randomUUID();
    const id = await upload(jpeg, session.id, clientPhotoId);
    sent.set(clientPhotoId, id);
    process.stdout.write('.');
    if (i % DUPLICATE_EVERY === 0) {
      duplicatesSent += 1;
      if (await upload(jpeg, session.id, clientPhotoId) !== id) wrongDuplicates += 1;
    }
    if (i % 50 === 0) process.stdout.write(` ${i}\n`);
  }

  const seconds = (Date.now() - startedAt) / 1000;
  const res = await request(`/api/photos?sessionId=${session.id}&limit=5000`);
  const stored = await res.json();
  const storedClientIds = new Set(stored.map((p) => p.clientPhotoId));
  const missing = [...sent.keys()].filter((id) => !storedClientIds.has(id)).length;
  const duplicated = stored.length - storedClientIds.size;

  console.log(`\n\nEnviadas:            ${sent.size} em ${seconds.toFixed(0)} s (${(seconds / COUNT).toFixed(2)} s por foto)`);
  console.log(`Novas tentativas:    ${retries}`);
  console.log(`Reenvios propositais: ${duplicatesSent}`);
  console.log(`No servidor:         ${stored.length}`);
  console.log(`Perdidas:            ${missing}`);
  console.log(`Duplicadas:          ${duplicated + wrongDuplicates}`);

  const passed = missing === 0 && duplicated === 0 && wrongDuplicates === 0 && stored.length === COUNT;
  console.log(passed ? '\nRESULTADO: PASSOU' : '\nRESULTADO: FALHOU');
  process.exit(passed ? 0 : 1);
})().catch((err) => {
  console.error(`\nRESULTADO: FALHOU (${err.message})`);
  process.exit(1);
});
