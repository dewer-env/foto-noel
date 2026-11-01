const { WebSocketServer, WebSocket } = require('ws');

let wss;

function attach(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
  });

  // Derruba conexões mortas (ex.: iPad que saiu do Wi-Fi sem fechar o socket).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function broadcast(event) {
  if (!wss) return;
  const data = JSON.stringify(event);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function clientCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = { attach, broadcast, clientCount };
