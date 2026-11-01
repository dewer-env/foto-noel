// Fila de envio guardada no IndexedDB do próprio iPhone.
// Uma foto só sai daqui quando o servidor confirma que recebeu.
//
// Item: { clientPhotoId, sessionId, code, createdAt, type, name, data (ArrayBuffer), error }
// Guardamos ArrayBuffer em vez de Blob porque versões antigas do Safari perdiam Blobs no IndexedDB.

const DB_NAME = 'papainoel-camera';
const STORE = 'queue';

let dbPromise;

function openDb() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'clientPhotoId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const queue = {
  put: (item) => run('readwrite', (s) => s.put(item)),
  remove: (clientPhotoId) => run('readwrite', (s) => s.delete(clientPhotoId)),
  // Em ordem de captura: a mais antiga sai primeiro.
  all: async () => (await run('readonly', (s) => s.getAll())).sort((a, b) => a.createdAt - b.createdAt),
};
