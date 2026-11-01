const http = require('node:http');
const os = require('node:os');
const express = require('express');
const { Bonjour } = require('bonjour-service');
const { PORT, VERSION, PUBLIC_DIR } = require('./config');
const events = require('./events');

const app = express();

app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION }));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/status', require('./routes/status'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

const { ICON_PATH, iconRoute } = require('./icons');
app.get(ICON_PATH, iconRoute);
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo grande demais' });
  console.error('[http]', err);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno' });
});

const server = http.createServer(app);
events.attach(server);

// Anuncia _papainoel._tcp na rede local para o futuro app nativo achar o servidor.
let bonjour;
function announce() {
  try {
    bonjour = new Bonjour({}, (err) => console.warn('[bonjour]', err.message));
    bonjour.publish({ name: 'Papai Noel', type: 'papainoel', port: PORT, txt: { version: VERSION } });
  } catch (err) {
    console.warn('[bonjour] não foi possível anunciar:', err.message);
  }
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Papai Noel v${VERSION} ouvindo na porta ${PORT}`);
  console.log(`  http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  iPhone: http://${ip}:${PORT}/camera/`);
    console.log(`  iPad:   http://${ip}:${PORT}/vitrine/`);
  }
  console.log(`  Balcão: http://localhost:${PORT}/balcao/`);
  console.log(`  Status: http://localhost:${PORT}/status/`);
  announce();
});

function shutdown() {
  console.log('Encerrando...');
  const done = () => process.exit(0);
  if (bonjour) bonjour.unpublishAll(() => bonjour.destroy());
  server.close(done);
  setTimeout(done, 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
