const PBKDF2_ITERATIONS = 150000;
const crypto = globalThis.crypto;

function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

export function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLocaleLowerCase().slice(0, 160) : ''; }
export function normalizeName(value) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 60) : ''; }

export function validateEmail(value) { const email = normalizeEmail(value); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : ''; }

export function validatePassphrase(value) {
  if (typeof value !== 'string' || value.length < 8) return { ok: false, reason: 'Use at least 8 characters.' };
  if (value.length > 200) return { ok: false, reason: 'Passphrase is too long.' };
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) return { ok: false, reason: 'Mix at least one letter and one number.' };
  return { ok: true, reason: '' };
}

export function accountId(email) { const normalized = normalizeEmail(email); return normalized ? `acct-${bytesToHex(new TextEncoder().encode(normalized)).slice(0, 32)}` : ''; }
export function scopedKey(id, name) { return `4.0-reads:${id}:${name}`; }

export async function derivePassphraseHash(passphrase, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], (pair) => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return bytesToHex(bits);
}

export function newSalt() { return bytesToHex(crypto.getRandomValues(new Uint8Array(16))); }

export async function createCredential(email, passphrase, name) {
  const validEmail = validateEmail(email);
  if (!validEmail) throw new Error('Enter a valid email address.');
  const passphraseCheck = validatePassphrase(passphrase);
  if (!passphraseCheck.ok) throw new Error(passphraseCheck.reason);
  const salt = newSalt();
  return { id: accountId(validEmail), email: validEmail, name: normalizeName(name) || validEmail.split('@')[0], salt, hash: await derivePassphraseHash(passphrase, salt), createdAt: new Date().toISOString() };
}

export async function verifyCredential(account, passphrase) {
  if (!account?.salt || !account?.hash || typeof passphrase !== 'string') return false;
  const candidate = await derivePassphraseHash(passphrase, account.salt);
  if (candidate.length !== account.hash.length) return false;
  let mismatch = 0;
  for (let index = 0; index < candidate.length; index += 1) mismatch |= candidate.charCodeAt(index) ^ account.hash.charCodeAt(index);
  return mismatch === 0;
}

export function publicProfile(account) { return account ? { id: account.id, email: account.email, name: account.name, createdAt: account.createdAt } : null; }
