/**
 * End-to-end encryption for 4.0-reads.
 *
 * The server never receives the passphrase, the key-encryption key, or the
 * master key. It stores an opaque wrapped master key and opaque per-record
 * ciphertext. A full database dump reveals record ids, sizes, and timestamps
 * — nothing else.
 *
 * Runs unchanged in the browser and in Node (both expose WebCrypto).
 */

const subtle = globalThis.crypto.subtle;
const KDF_ITERATIONS = 600000;
const AUTH_CONTEXT = '4.0-reads:auth:v1';
const ENC_CONTEXT = '4.0-reads:enc:v1';
const RECOVERY_CONTEXT = '4.0-reads:recovery:v1';

const utf8 = (value) => new TextEncoder().encode(value);
export function toBase64(bytes) { let binary = ''; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte); return btoa(binary); }
export function fromBase64(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
export function randomBytes(length) { return globalThis.crypto.getRandomValues(new Uint8Array(length)); }

/** Opaque record id. Never derive ids from content: a `creator-<host>` id would leak the host to the server. */
export function randomId() { return toBase64(randomBytes(16)).slice(0, 22).replace(/\+/g, '-').replace(/\//g, '_'); }

async function deriveBits(passphrase, salt, context, iterations) {
  const material = await subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveBits']);
  const scopedSalt = new Uint8Array([...fromBase64(salt), ...utf8(context)]);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: scopedSalt, iterations }, material, 256));
}

async function aesKey(raw, usages = ['encrypt', 'decrypt']) {
  if (raw instanceof CryptoKey) return raw;
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
}

/**
 * Import the master key as a non-extractable CryptoKey. Stored this way in IndexedDB,
 * the raw bytes cannot be read back by anything — script on the page included — so a
 * cross-site scripting bug can use the key while the tab is open but cannot steal it.
 */
export async function importMasterKey(raw) { return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }

/**
 * Split one passphrase into an auth secret the server may see and a key-encryption
 * key it may not. Domain-separated salts keep the two independent: holding authKey
 * gives no information about kek.
 */
export async function deriveKeys(passphrase, salt, { iterations = KDF_ITERATIONS } = {}) {
  const [authKey, kek] = await Promise.all([
    deriveBits(passphrase, salt, AUTH_CONTEXT, iterations),
    deriveBits(passphrase, salt, ENC_CONTEXT, iterations),
  ]);
  return { authKey: toBase64(authKey), kek };
}

export function newSalt() { return toBase64(randomBytes(16)); }
export function newMasterKey() { return randomBytes(32); }

/**
 * Recovery key: the only other way to unwrap the master key. Shown once, never stored by us.
 * Base32 so that what the reader writes down converts back to the exact key bytes — an
 * uppercase-and-strip display format would be lossy and make recovery impossible.
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function toBase32(bytes) {
  let bits = 0, value = 0, output = '';
  for (const byte of new Uint8Array(bytes)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
export function fromBase32(value) {
  const clean = String(value).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, accumulator = 0;
  const output = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    accumulator = (accumulator << 5) | index; bits += 5;
    if (bits >= 8) { output.push((accumulator >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(output);
}
export function newRecoveryKey() { return toBase32(randomBytes(32)); }
/** Display only. Dashes and case are stripped on the way back in, so this stays lossless. */
export function normalizeRecoveryKey(value) { return String(value).toUpperCase().replace(/[^A-Z2-7]/g, ''); }
/** The recovery key authenticates on its own, so it needs an auth secret the server can check. */
export async function deriveRecoveryAuth(recoveryKey, salt, { iterations = KDF_ITERATIONS } = {}) {
  return toBase64(await deriveBits(normalizeRecoveryKey(recoveryKey), salt, RECOVERY_CONTEXT, iterations));
}
export function formatRecoveryKey(value) { return (normalizeRecoveryKey(value).match(/.{1,4}/g) || []).join('-'); }

async function wrap(keyBytes, masterKey) {
  const iv = randomBytes(12);
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyBytes, ['encrypt']), masterKey);
  return { iv: toBase64(iv), ct: toBase64(ciphertext) };
}
async function unwrap(keyBytes, wrapped) {
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(wrapped.iv) }, await aesKey(keyBytes, ['decrypt']), fromBase64(wrapped.ct));
  return new Uint8Array(plain);
}

export async function wrapMasterKey(kek, masterKey) { return wrap(kek, masterKey); }
export async function unwrapMasterKey(kek, wrapped) { return unwrap(kek, wrapped); }
export async function wrapWithRecoveryKey(recoveryKey, masterKey) { return wrap(fromBase32(recoveryKey), masterKey); }
export async function unwrapWithRecoveryKey(recoveryKey, wrapped) { return unwrap(fromBase32(recoveryKey), wrapped); }

/** Encrypt one record under the master key. A fresh IV per call: never reuse an IV with the same key. */
export async function encryptRecord(masterKey, record) {
  const iv = randomBytes(12);
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(masterKey, ['encrypt']), utf8(JSON.stringify(record)));
  return { iv: toBase64(iv), ct: toBase64(ciphertext) };
}
export async function decryptRecord(masterKey, payload) {
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(payload.iv) }, await aesKey(masterKey, ['decrypt']), fromBase64(payload.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

export const KDF = { iterations: KDF_ITERATIONS };
