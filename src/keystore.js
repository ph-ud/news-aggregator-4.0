/**
 * Holds the unwrapped master key across reloads as a non-extractable CryptoKey.
 * IndexedDB can structured-clone a CryptoKey, so the key survives a refresh without
 * its raw bytes ever being readable by script.
 */
const DB_NAME = '4.0-reads-keys';
const STORE = 'keys';

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function rememberKey(userId, key) { try { await withStore('readwrite', (store) => store.put(key, userId)); } catch { /* private mode: re-entry required */ } }
export async function recallKey(userId) { try { return (await withStore('readonly', (store) => store.get(userId))) || null; } catch { return null; } }
export async function forgetKeys() { try { await withStore('readwrite', (store) => store.clear()); } catch { /* nothing to clear */ } }
