import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as signBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { newChallenge, consumeChallenge, verifyClientData, verifyAuthenticatorData, verifyAssertionSignature, verifySignCount, relyingParty, ALGORITHMS } from '../server/webauthn.mjs';

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:4173';
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('create table challenges (challenge text primary key, purpose text not null, user_id text, expires_at text not null)');
  return db;
}

/** An authenticator, reduced to what the server actually checks. */
function authenticator({ rpId = RP_ID, flags = 0x05, signCount = 1 } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return {
    publicKey: spki,
    assert({ challenge, origin = ORIGIN, type = 'webauthn.get', key = privateKey }) {
      const authData = Buffer.concat([createHash('sha256').update(rpId).digest(), Buffer.from([flags]), (() => { const c = Buffer.alloc(4); c.writeUInt32BE(signCount); return c; })()]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
      const signature = signBytes('sha256', Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]), { key, dsaEncoding: 'der' });
      return { authenticatorData: b64url(authData), clientDataJSON: b64url(clientDataJSON), signature: b64url(signature) };
    },
  };
}

const verifyAll = (device, response, challenge) => {
  verifyClientData(response.clientDataJSON, { type: 'webauthn.get', challenge, origin: ORIGIN });
  verifyAuthenticatorData(response.authenticatorData, { rpId: RP_ID });
  verifyAssertionSignature({ publicKey: device.publicKey, algorithm: ALGORITHMS.ES256, ...response });
};

test('a genuine assertion verifies', () => {
  const db = database();
  const challenge = newChallenge(db, 'unlock');
  const device = authenticator();
  verifyAll(device, device.assert({ challenge }), consumeChallenge(db, challenge, 'unlock').challenge);
});

test('a challenge answers exactly once', () => {
  const db = database();
  const challenge = newChallenge(db, 'unlock');
  consumeChallenge(db, challenge, 'unlock');
  /* Without this, an assertion captured once could be replayed forever. */
  assert.throws(() => consumeChallenge(db, challenge, 'unlock'), /expired/);
});

test('a challenge cannot be spent on a different purpose or account', () => {
  const db = database();
  assert.throws(() => consumeChallenge(db, newChallenge(db, 'register', 'user-1'), 'unlock'), /expired/);
  assert.throws(() => consumeChallenge(db, newChallenge(db, 'register', 'user-1'), 'register', 'user-2'), /expired/);
  assert.throws(() => consumeChallenge(db, 'never-issued', 'unlock'), /expired/);
});

test('an expired challenge is refused', () => {
  const db = database();
  db.prepare('insert into challenges (challenge, purpose, user_id, expires_at) values (?, ?, ?, ?)').run('stale', 'unlock', null, new Date(Date.now() - 1000).toISOString());
  assert.throws(() => consumeChallenge(db, 'stale', 'unlock'), /expired/);
});

test('an assertion for another challenge, origin, or site is refused', () => {
  const device = authenticator();
  const challenge = b64url(randomBytes(32));
  assert.throws(() => verifyClientData(device.assert({ challenge: b64url(randomBytes(32)) }).clientDataJSON, { type: 'webauthn.get', challenge, origin: ORIGIN }), /expired/);
  assert.throws(() => verifyClientData(device.assert({ challenge, origin: 'https://evil.example' }).clientDataJSON, { type: 'webauthn.get', challenge, origin: ORIGIN }), /different site/);
  /* A registration signature must not be replayable as a sign-in. */
  assert.throws(() => verifyClientData(device.assert({ challenge, type: 'webauthn.create' }).clientDataJSON, { type: 'webauthn.get', challenge, origin: ORIGIN }), /Malformed/);
  assert.throws(() => verifyAuthenticatorData(authenticator({ rpId: 'evil.example' }).assert({ challenge }).authenticatorData, { rpId: RP_ID }), /different site/);
});

test('a person must have been verified, not merely present', () => {
  const challenge = b64url(randomBytes(32));
  /* 0x01 is user-present alone: a tap. User verification is the gesture an agent cannot make. */
  assert.throws(() => verifyAuthenticatorData(authenticator({ flags: 0x01 }).assert({ challenge }).authenticatorData, { rpId: RP_ID }), /fingerprint, face, or device PIN/);
  assert.throws(() => verifyAuthenticatorData(authenticator({ flags: 0x00 }).assert({ challenge }).authenticatorData, { rpId: RP_ID }), /not confirmed/);
});

test('a signature from another key is refused', () => {
  const challenge = b64url(randomBytes(32));
  const device = authenticator();
  const impostor = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  assert.throws(() => verifyAssertionSignature({ publicKey: device.publicKey, algorithm: ALGORITHMS.ES256, ...device.assert({ challenge, key: impostor }) }), /did not match/);
  const response = device.assert({ challenge });
  assert.throws(() => verifyAssertionSignature({ publicKey: device.publicKey, algorithm: ALGORITHMS.ES256, ...response, signature: b64url(randomBytes(70)) }), /did not match/);
  /* Tampering with what was signed invalidates it, so the flags cannot be edited in flight. */
  const tampered = { ...response, authenticatorData: authenticator({ flags: 0x05, signCount: 99 }).assert({ challenge }).authenticatorData };
  assert.throws(() => verifyAssertionSignature({ publicKey: device.publicKey, algorithm: ALGORITHMS.ES256, ...tampered }), /did not match/);
});

test('truncated or unparseable input is a refusal, not a crash', () => {
  assert.throws(() => verifyAuthenticatorData(b64url(randomBytes(20)), { rpId: RP_ID }), /Malformed/);
  assert.throws(() => verifyClientData(b64url(Buffer.from('not json')), { type: 'webauthn.get', challenge: 'x', origin: ORIGIN }), /Malformed/);
  assert.throws(() => verifyAssertionSignature({ publicKey: 'not-a-key', algorithm: ALGORITHMS.ES256, authenticatorData: b64url(randomBytes(37)), clientDataJSON: b64url(Buffer.from('{}')), signature: b64url(randomBytes(70)) }), /no longer usable/);
});

test('a counter that goes backwards means a cloned passkey', () => {
  assert.equal(verifySignCount(4, 5), 5);
  assert.throws(() => verifySignCount(5, 5), /copy/);
  assert.throws(() => verifySignCount(9, 2), /copy/);
  /* Authenticators without a counter report zero forever; that is not an attack. */
  assert.equal(verifySignCount(0, 0), 0);
});

test('the relying party comes from configuration when it is set', () => {
  const request = { headers: { host: 'reads.example:8080' } };
  assert.deepEqual(relyingParty(request), { id: 'reads.example', origin: 'https://reads.example:8080' });
  process.env.ORIGIN = 'https://reads.example';
  try { assert.deepEqual(relyingParty({ headers: { host: 'spoofed.example' } }), { id: 'reads.example', origin: 'https://reads.example' }); }
  finally { delete process.env.ORIGIN; }
  assert.equal(relyingParty({ headers: { host: 'localhost:4173' } }).origin, 'http://localhost:4173');
});
