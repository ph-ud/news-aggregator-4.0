import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export const SESSION_TTL_DAYS = 30;

/**
 * The client sends authKey — already the output of 600k PBKDF2 rounds — and never
 * the passphrase. We hash it again with scrypt so that a database dump yields
 * neither the passphrase nor a replayable authKey.
 */
export function hashAuthKey(authKey, salt = randomBytes(16).toString('base64')) {
  const hash = scryptSync(authKey, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('base64');
  return { hash, salt };
}
export function verifyAuthKey(authKey, salt, expected) {
  const candidate = Buffer.from(hashAuthKey(authKey, salt).hash);
  const target = Buffer.from(expected);
  return candidate.length === target.length && timingSafeEqual(candidate, target);
}

/** Session tokens are stored hashed: a leaked database cannot be replayed as a live session. */
export function newSessionToken() { return randomBytes(32).toString('base64url'); }
export function hashToken(token) { return createHash('sha256').update(token).digest('base64'); }

/**
 * Sign-in needs the KDF salt before a passphrase can be stretched, which would
 * otherwise let anyone probe which emails exist. Unknown emails get a stable,
 * server-derived decoy salt so the response is indistinguishable from a real one.
 */
export function decoySalt(email, secret) { return createHmac('sha256', secret).update(`salt:${email}`).digest('base64').slice(0, 24); }

export function serverSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be set in production.');
  return 'development-only-secret';
}

const attempts = new Map();
/** Coarse per-identity throttle so an online guessing attack is not free. */
export function rateLimit(key, { limit = 10, windowMs = 60000 } = {}) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) { attempts.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  entry.count += 1;
  return entry.count <= limit;
}
export function clearRateLimit(key) { attempts.delete(key); }
