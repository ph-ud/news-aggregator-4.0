import { createHash, createPublicKey, createVerify, randomBytes, verify as verifySignature } from 'node:crypto';

/**
 * WebAuthn verification, without a dependency.
 *
 * Only two things are parsed: `clientDataJSON`, which is JSON, and `authenticatorData`, which
 * is a fixed byte layout. The attestation object — the one part that would need CBOR — is
 * never sent: registration happens inside an authenticated session and we request no
 * attestation, so the browser hands us the public key directly through `getPublicKey()`.
 * Attestation proves which authenticator model made a key, which is a fleet-management
 * question this app does not ask.
 *
 * What actually protects the account is checked here in full: a single-use challenge, the
 * origin, the relying-party id, user verification, the signature, and a counter that must
 * not go backwards.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const FLAG = { userPresent: 0x01, userVerified: 0x04 };
/** COSE algorithm identifiers we accept: ES256 and RS256, which is what platforms produce. */
export const ALGORITHMS = { ES256: -7, RS256: -257 };

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64url = (value) => Buffer.from(String(value), 'base64url');
const fail = (message) => Object.assign(new Error(message), { status: 401 });

/**
 * The relying-party id is the origin's hostname, and the expected origin is the site itself.
 * Both are configurable because a deployment behind a proxy cannot trust the Host header;
 * ORIGIN is the setting that matters in production.
 */
export function relyingParty(request) {
  const configured = process.env.ORIGIN;
  const host = configured ? new URL(configured).host : String(request.headers.host || 'localhost');
  const hostname = host.split(':')[0];
  const scheme = configured ? new URL(configured).protocol.replace(':', '') : (hostname === 'localhost' || hostname === '127.0.0.1' ? 'http' : 'https');
  return { id: process.env.RP_ID || hostname, origin: configured ? new URL(configured).origin : `${scheme}://${host}` };
}

export function newChallenge(db, purpose, userId = null) {
  db.prepare('delete from challenges where expires_at < ?').run(new Date().toISOString());
  const challenge = randomBytes(32).toString('base64url');
  db.prepare('insert into challenges (challenge, purpose, user_id, expires_at) values (?, ?, ?, ?)')
    .run(challenge, purpose, userId, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString());
  return challenge;
}

/** Deletes as it reads: a challenge that has been answered once can never be answered again. */
export function consumeChallenge(db, challenge, purpose, userId = null) {
  const value = typeof challenge === 'string' ? challenge : '';
  const row = db.prepare('select * from challenges where challenge = ?').get(value);
  if (row) db.prepare('delete from challenges where challenge = ?').run(value);
  if (!row || row.purpose !== purpose) throw fail('That sign-in attempt has expired. Try again.');
  if (new Date(row.expires_at) < new Date()) throw fail('That sign-in attempt has expired. Try again.');
  if (userId && row.user_id !== userId) throw fail('That sign-in attempt has expired. Try again.');
  return row;
}

/**
 * The client data binds the assertion to this origin and this challenge. Checking the type
 * matters as much as the rest: without it a registration signature could be replayed as a
 * sign-in.
 */
export function verifyClientData(clientDataJSON, { type, challenge, origin }) {
  let data;
  try { data = JSON.parse(fromB64url(clientDataJSON).toString('utf8')); }
  catch { throw fail('Malformed passkey response.'); }
  if (data.type !== type) throw fail('Malformed passkey response.');
  if (data.challenge !== challenge) throw fail('That sign-in attempt has expired. Try again.');
  if (data.origin !== origin) throw fail('That passkey belongs to a different site.');
  if (data.crossOrigin) throw fail('That passkey belongs to a different site.');
  return data;
}

/** Fixed layout: 32 bytes of rpIdHash, one flags byte, then a four-byte counter. */
export function parseAuthenticatorData(authenticatorData) {
  const bytes = fromB64url(authenticatorData);
  if (bytes.length < 37) throw fail('Malformed passkey response.');
  return { rpIdHash: bytes.subarray(0, 32), flags: bytes[32], signCount: bytes.readUInt32BE(33), bytes };
}

export function verifyAuthenticatorData(authenticatorData, { rpId }) {
  const parsed = parseAuthenticatorData(authenticatorData);
  if (!parsed.rpIdHash.equals(createHash('sha256').update(rpId).digest())) throw fail('That passkey belongs to a different site.');
  if (!(parsed.flags & FLAG.userPresent)) throw fail('That passkey was not confirmed on the device.');
  /* User verification is required, not optional: it is the gesture — a fingerprint, a PIN —
     that an agent driving the browser cannot perform on the reader's behalf. */
  if (!(parsed.flags & FLAG.userVerified)) throw fail('Unlock the passkey with your fingerprint, face, or device PIN.');
  return parsed;
}

/** WebAuthn signs `authenticatorData ‖ SHA-256(clientDataJSON)`, and nothing else. */
export function verifyAssertionSignature({ publicKey, algorithm, authenticatorData, clientDataJSON, signature }) {
  const signed = Buffer.concat([fromB64url(authenticatorData), createHash('sha256').update(fromB64url(clientDataJSON)).digest()]);
  let key;
  try { key = createPublicKey({ key: Buffer.from(String(publicKey), 'base64'), format: 'der', type: 'spki' }); }
  catch { throw fail('That passkey is no longer usable.'); }
  const bytes = fromB64url(signature);
  const ok = algorithm === ALGORITHMS.RS256
    ? createVerify('sha256').update(signed).verify(key, bytes)
    : verifySignature('sha256', signed, { key, dsaEncoding: 'der' }, bytes);
  if (!ok) throw fail('That passkey did not match.');
  return true;
}

/**
 * A counter that goes backwards means the credential was cloned. Authenticators that do not
 * keep a counter report zero forever, which is normal and must not be read as an attack.
 */
export function verifySignCount(stored, presented) {
  if (presented === 0 && stored === 0) return 0;
  if (presented <= stored) throw fail('That passkey looks like a copy. Sign in with your passphrase.');
  return presented;
}

export const encodeChallenge = b64url;
