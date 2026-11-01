// Conexão WebSocket com o servidor que reconecta sozinha (1 s, 2 s, 4 s… até 15 s).
// Usado pela câmera, e depois pela vitrine e pelo balcão.
export function connectRealtime({ onEvent, onOpen, onClose } = {}) {
  let delay = 1000;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { delay = 1000; onOpen?.(); };
    ws.onmessage = (e) => {
      let event;
      try { event = JSON.parse(e.data); } catch { return; }
      onEvent?.(event);
    };
    ws.onclose = () => {
      onClose?.();
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  }

  open();
}
