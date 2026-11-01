// Cliente WebSocket de teste: mostra cada evento recebido e reconecta sozinho.
// Uso: npm run ws            (ou: node scripts/ws-listen.js ws://192.168.0.10:3000/ws)
const WebSocket = require('ws');

const url = process.argv[2] || 'ws://localhost:3000/ws';

function connect() {
  const ws = new WebSocket(url);
  ws.on('open', () => console.log(`[conectado] ${url}`));
  ws.on('message', (data) => console.log(new Date().toLocaleTimeString(), data.toString()));
  ws.on('close', () => {
    console.log('[desconectado] tentando de novo em 2 s');
    setTimeout(connect, 2000);
  });
  ws.on('error', () => {});
}

connect();
