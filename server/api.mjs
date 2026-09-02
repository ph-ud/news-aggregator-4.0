import { randomUUID } from 'node:crypto';
import { hashAuthKey, verifyAuthKey, newSessionToken, hashToken, decoySalt, serverSecret, rateLimit, clearRateLimit, SESSION_TTL_DAYS } from './auth.mjs';
import { readJson, sendJson, parseCookies, sessionCookie, clearedCookie, sameOrigin } from './http.mjs';
import { newChallenge, consumeChallenge, relyingParty, verifyClientData, verifyAuthenticatorData, verifyAssertionSignature, verifySignCount, ALGORITHMS } from './webauthn.mjs';

/** Structural limits only. The server cannot inspect ciphertext, so these are the sole abuse controls. */
const LIMITS = { recordBytes: 64 * 1024, recordsPerUser: 5000, batch: 200, iterations: { min: 100000, max: 2000000 }, passkeysPerUser: 10 };
const fail = (status, message) => Object.assign(new Error(message), { status });

const asString = (value, max) => (typeof value === 'string' && value.length && value.length <= max ? value : null);
const asEmail = (value) => { const email = asString(value, 160)?.trim().toLowerCase(); return email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null; };
const asWrapped = (value) => { const iv = asString(value?.iv, 64); const ct = asString(value?.ct, 4096); return iv && ct ? JSON.stringify({ iv, ct }) : null; };

function expiry(days = SESSION_TTL_DAYS) { return new Date(Date.now() + days * 86400000).toISOString(); }

function startSession(db, response, userId, extraHeaders = {}) {
  const token = newSessionToken();
  db.prepare('insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)')
    .run(hashToken(token), userId, new Date().toISOString(), expiry());
  return { ...extraHeaders, 'Set-Cookie': sessionCookie(token, SESSION_TTL_DAYS * 86400) };
}

function currentUser(db, request) {
  const token = parseCookies(request).session;
  if (!token) return null;
  const session = db.prepare('select user_id, expires_at from sessions where token_hash = ?').get(hashToken(token));
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) { db.prepare('delete from sessions where token_hash = ?').run(hashToken(token)); return null; }
  return db.prepare('select * from users where id = ?').get(session.user_id) || null;
}

const profileOf = (user) => ({ id: user.id, email: user.email, name: user.name });
const passkeysOf = (db, userId) => db.prepare('select credential_id as id, created_at as addedAt from passkeys where user_id = ? order by created_at').all(userId);
const secretsOf = (user) => ({ wrappedMk: JSON.parse(user.wrapped_mk), kdfSalt: user.kdf_salt, iterations: user.kdf_iterations });

const routes = {
  /* The KDF salt is public, but handing it out reveals which emails exist — so unknown
     emails receive a stable decoy derived from the server secret instead. */
  'POST /api/auth/salt': async (db, request, response) => {
    const body = await readJson(request);
    const email = asEmail(body.email);
    if (!email) throw fail(400, 'A valid email is required.');
    const user = db.prepare('select kdf_salt, kdf_iterations, recovery_kdf_salt, recovery_kdf_iterations from users where email = ?').get(email);
    /* The recovery key derives from its own salt so that changing a passphrase — which
       rotates kdf_salt — cannot silently invalidate it. */
    sendJson(response, 200, user
      ? { salt: user.kdf_salt, iterations: user.kdf_iterations, recoverySalt: user.recovery_kdf_salt, recoveryIterations: user.recovery_kdf_iterations }
      : { salt: decoySalt(email, serverSecret()), iterations: 600000, recoverySalt: decoySalt(`recovery:${email}`, serverSecret()), recoveryIterations: 600000 });
  },

  'POST /api/auth/signup': async (db, request, response) => {
    const body = await readJson(request);
    const email = asEmail(body.email);
    const authKey = asString(body.authKey, 128);
    const kdfSalt = asString(body.kdfSalt, 64);
    const wrappedMk = asWrapped(body.wrappedMk);
    const recoveryWrap = asWrapped(body.recoveryWrap);
    const recoveryKey = asString(body.recoveryAuthKey, 128);
    const recoveryKdfSalt = asString(body.recoveryKdfSalt, 64);
    const iterations = Number(body.iterations);
    if (!email || !authKey || !kdfSalt || !wrappedMk || !recoveryWrap || !recoveryKey || !recoveryKdfSalt) throw fail(400, 'Incomplete sign-up payload.');
    if (!Number.isInteger(iterations) || iterations < LIMITS.iterations.min || iterations > LIMITS.iterations.max) throw fail(400, 'Unsupported key-derivation settings.');
    if (db.prepare('select 1 from users where email = ?').get(email)) throw fail(409, 'That email already has an account.');

    const auth = hashAuthKey(authKey);
    const recovery = hashAuthKey(recoveryKey);
    const user = { id: randomUUID(), email, name: asString(body.name, 60)?.trim() || email.split('@')[0] };
    db.prepare(`insert into users (id, email, name, kdf_salt, kdf_iterations, auth_hash, auth_salt, wrapped_mk, recovery_wrap, recovery_hash, recovery_salt, recovery_kdf_salt, recovery_kdf_iterations, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.email, user.name, kdfSalt, iterations, auth.hash, auth.salt, wrappedMk, recoveryWrap, recovery.hash, recovery.salt, recoveryKdfSalt, iterations, new Date().toISOString());
    sendJson(response, 201, { profile: user, wrappedMk: JSON.parse(wrappedMk) }, startSession(db, response, user.id));
  },

  'POST /api/auth/signin': async (db, request, response) => {
    const body = await readJson(request);
    const email = asEmail(body.email);
    const authKey = asString(body.authKey, 128);
    if (!email || !authKey) throw fail(400, 'Email and credential are required.');
    if (!rateLimit(`signin:${email}`)) throw fail(429, 'Too many attempts. Wait a minute and try again.');
    const user = db.prepare('select * from users where email = ?').get(email);
    /* One message for "no such account" and "wrong passphrase": neither confirms the other. */
    if (!user || !verifyAuthKey(authKey, user.auth_salt, user.auth_hash)) throw fail(401, 'Those credentials do not match an account.');
    clearRateLimit(`signin:${email}`);
    sendJson(response, 200, { profile: profileOf(user), ...secretsOf(user) }, startSession(db, response, user.id));
  },

  /* Forgotten passphrase: the recovery key is the second way to unwrap the master key.
     It authenticates on its own, then the client re-wraps under a new passphrase. */
  'POST /api/auth/recover': async (db, request, response) => {
    const body = await readJson(request);
    const email = asEmail(body.email);
    const recoveryAuthKey = asString(body.recoveryAuthKey, 128);
    if (!email || !recoveryAuthKey) throw fail(400, 'Email and recovery key are required.');
    if (!rateLimit(`recover:${email}`, { limit: 5 })) throw fail(429, 'Too many attempts. Wait a minute and try again.');
    const user = db.prepare('select * from users where email = ?').get(email);
    if (!user || !verifyAuthKey(recoveryAuthKey, user.recovery_salt, user.recovery_hash)) throw fail(401, 'That recovery key does not match an account.');
    clearRateLimit(`recover:${email}`);
    sendJson(response, 200, { profile: profileOf(user), recoveryWrap: JSON.parse(user.recovery_wrap) }, startSession(db, response, user.id));
  },

  /* Re-key after recovery or a deliberate change. The master key never changes, so
     nothing needs re-encrypting — only its wrapper does. */
  /* Deliberately leaves every recovery_* column alone: the recovery key wraps the same
     master key and must keep working across a passphrase change. */
  'POST /api/auth/rekey': async (db, request, response, user) => {
    if (!user) throw fail(401, 'Sign in first.');
    const body = await readJson(request);
    const authKey = asString(body.authKey, 128);
    const kdfSalt = asString(body.kdfSalt, 64);
    const wrappedMk = asWrapped(body.wrappedMk);
    const iterations = Number(body.iterations);
    if (!authKey || !kdfSalt || !wrappedMk) throw fail(400, 'Incomplete re-key payload.');
    if (!Number.isInteger(iterations) || iterations < LIMITS.iterations.min || iterations > LIMITS.iterations.max) throw fail(400, 'Unsupported key-derivation settings.');
    const auth = hashAuthKey(authKey);
    db.prepare('update users set auth_hash = ?, auth_salt = ?, kdf_salt = ?, kdf_iterations = ?, wrapped_mk = ? where id = ?')
      .run(auth.hash, auth.salt, kdfSalt, iterations, wrappedMk, user.id);
    /* Every other device's session dies with the old passphrase. Passkeys are left alone:
       like the recovery key, each wraps the same unchanged master key. */
    db.prepare('delete from sessions where user_id = ?').run(user.id);
    sendJson(response, 200, { ok: true }, startSession(db, response, user.id));
  },

  'POST /api/auth/signout': async (db, request, response) => {
    const token = parseCookies(request).session;
    if (token) db.prepare('delete from sessions where token_hash = ?').run(hashToken(token));
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearedCookie });
  },

  'GET /api/auth/me': async (db, request, response, user) => {
    if (!user) return sendJson(response, 200, { signedIn: false });
    sendJson(response, 200, { signedIn: true, profile: profileOf(user), ...secretsOf(user), passkeys: passkeysOf(db, user.id) });
  },

  /* ---------- passkeys ----------
     A passkey is a second wrapper around the same master key, opened by a secret the
     authenticator derives through the PRF extension and discloses to nobody. The server
     verifies the assertion and hands back a blob it cannot read; only the authenticator,
     after the reader's fingerprint or PIN, produces the secret that opens it. */

  'POST /api/auth/passkey/challenge': async (db, request, response, user) => {
    const body = await readJson(request);
    const purpose = body.purpose === 'register' ? 'register' : 'unlock';
    if (purpose === 'register' && !user) throw fail(401, 'Sign in first.');
    if (purpose === 'unlock' && !rateLimit(`passkey:${request.socket.remoteAddress || 'unknown'}`, { limit: 20 })) throw fail(429, 'Too many attempts. Wait a minute and try again.');
    const { id: rpId } = relyingParty(request);
    sendJson(response, 200, {
      challenge: newChallenge(db, purpose, user?.id || null),
      rpId,
      ...(purpose === 'register' ? { userId: Buffer.from(user.id).toString('base64url'), userName: user.email, userDisplayName: user.name, existing: passkeysOf(db, user.id).map((key) => key.id) } : {}),
    });
  },

  /* Registration runs inside an authenticated session and requests no attestation, so the
     browser's own `getPublicKey()` is the public key of record and there is no CBOR to parse.
     The wrapped master key arrives already encrypted under the passkey's PRF secret. */
  'POST /api/auth/passkey/register': async (db, request, response, user) => {
    if (!user) throw fail(401, 'Sign in first.');
    const body = await readJson(request);
    const credentialId = asString(body.credentialId, 512);
    const publicKey = asString(body.publicKey, 2048);
    const algorithm = Number(body.algorithm);
    const wrappedMk = asWrapped(body.wrappedMk);
    if (!credentialId || !publicKey || !wrappedMk) throw fail(400, 'Incomplete passkey.');
    if (![ALGORITHMS.ES256, ALGORITHMS.RS256].includes(algorithm)) throw fail(400, 'Unsupported passkey algorithm.');
    if (passkeysOf(db, user.id).length >= LIMITS.passkeysPerUser) throw fail(409, 'That account already has the maximum number of passkeys.');
    if (db.prepare('select 1 from passkeys where credential_id = ?').get(credentialId)) throw fail(409, 'That passkey is already registered.');

    const { id: rpId, origin } = relyingParty(request);
    const challenge = consumeChallenge(db, body.challenge, 'register', user.id);
    verifyClientData(body.clientDataJSON, { type: 'webauthn.create', challenge: challenge.challenge, origin });
    const authenticator = verifyAuthenticatorData(body.authenticatorData, { rpId });
    db.prepare('insert into passkeys (credential_id, user_id, public_key, algorithm, sign_count, wrapped_mk, created_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(credentialId, user.id, publicKey, algorithm, authenticator.signCount, wrappedMk, new Date().toISOString());
    sendJson(response, 201, { ok: true, passkeys: passkeysOf(db, user.id) });
  },

  /* The assertion both authenticates the account and identifies it: a discoverable credential
     means the reader types no email. The response carries the passkey-wrapped master key,
     which is useless without the secret the authenticator just produced in the browser. */
  'POST /api/auth/passkey/assert': async (db, request, response) => {
    const body = await readJson(request);
    const credentialId = asString(body.credentialId, 512);
    if (!credentialId) throw fail(400, 'Incomplete passkey response.');
    if (!rateLimit(`passkey-assert:${credentialId}`)) throw fail(429, 'Too many attempts. Wait a minute and try again.');
    const passkey = db.prepare('select * from passkeys where credential_id = ?').get(credentialId);
    /* Same message whether the credential is unknown or the signature is wrong. */
    if (!passkey) throw fail(401, 'That passkey did not match.');

    const { id: rpId, origin } = relyingParty(request);
    const challenge = consumeChallenge(db, body.challenge, 'unlock');
    verifyClientData(body.clientDataJSON, { type: 'webauthn.get', challenge: challenge.challenge, origin });
    const authenticator = verifyAuthenticatorData(body.authenticatorData, { rpId });
    verifyAssertionSignature({ publicKey: passkey.public_key, algorithm: passkey.algorithm, authenticatorData: body.authenticatorData, clientDataJSON: body.clientDataJSON, signature: body.signature });
    const signCount = verifySignCount(passkey.sign_count, authenticator.signCount);
    db.prepare('update passkeys set sign_count = ? where credential_id = ?').run(signCount, credentialId);
    clearRateLimit(`passkey-assert:${credentialId}`);

    const user = db.prepare('select * from users where id = ?').get(passkey.user_id);
    if (!user) throw fail(401, 'That passkey did not match.');
    sendJson(response, 200, { profile: profileOf(user), wrappedMk: JSON.parse(passkey.wrapped_mk) }, startSession(db, response, user.id));
  },

  'POST /api/auth/passkey/remove': async (db, request, response, user) => {
    if (!user) throw fail(401, 'Sign in first.');
    const body = await readJson(request);
    const credentialId = asString(body.credentialId, 512);
    if (!credentialId) throw fail(400, 'Which passkey?');
    db.prepare('delete from passkeys where credential_id = ? and user_id = ?').run(credentialId, user.id);
    sendJson(response, 200, { ok: true, passkeys: passkeysOf(db, user.id) });
  },

  'GET /api/records': async (db, request, response, user, url) => {
    if (!user) throw fail(401, 'Sign in first.');
    const since = url.searchParams.get('since') || '';
    const rows = db.prepare('select id, iv, ct, updated_at as updatedAt, deleted from records where user_id = ? and updated_at > ? order by updated_at')
      .all(user.id, since);
    sendJson(response, 200, { records: rows.map((row) => ({ ...row, deleted: Boolean(row.deleted) })), syncedAt: new Date().toISOString() });
  },

  'POST /api/records': async (db, request, response, user) => {
    if (!user) throw fail(401, 'Sign in first.');
    const body = await readJson(request);
    const records = Array.isArray(body.records) ? body.records : null;
    if (!records || !records.length) throw fail(400, 'No records supplied.');
    if (records.length > LIMITS.batch) throw fail(413, `At most ${LIMITS.batch} records per request.`);

    const prepared = records.map((record) => {
      const id = asString(record?.id, 64);
      const iv = asString(record?.iv, 64);
      const ct = asString(record?.ct, LIMITS.recordBytes);
      if (!id || !iv || !ct) throw fail(400, 'Each record needs an id, iv, and ciphertext.');
      return { id, iv, ct, deleted: record.deleted ? 1 : 0 };
    });

    const existing = db.prepare('select count(*) as total from records where user_id = ? and deleted = 0').get(user.id).total;
    const incoming = new Set(prepared.map((record) => record.id));
    const known = db.prepare(`select id from records where user_id = ?`).all(user.id).map((row) => row.id);
    const added = [...incoming].filter((id) => !known.includes(id)).length;
    if (existing + added > LIMITS.recordsPerUser) throw fail(413, 'Library is full.');

    const now = new Date().toISOString();
    const upsert = db.prepare(`insert into records (user_id, id, iv, ct, updated_at, deleted) values (?, ?, ?, ?, ?, ?)
                               on conflict(user_id, id) do update set iv = excluded.iv, ct = excluded.ct, updated_at = excluded.updated_at, deleted = excluded.deleted`);
    db.exec('begin');
    try { for (const record of prepared) upsert.run(user.id, record.id, record.iv, record.ct, now, record.deleted); db.exec('commit'); }
    catch (error) { db.exec('rollback'); throw error; }
    sendJson(response, 200, { ok: true, syncedAt: now, count: prepared.length });
  },
};

export async function handleApi(db, request, response, url) {
  const key = `${request.method} ${url.pathname}`;
  const route = routes[key];
  if (!route) return false;
  try {
    if (request.method !== 'GET' && !sameOrigin(request)) throw fail(403, 'Cross-origin request refused.');
    await route(db, request, response, currentUser(db, request), url);
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong.' });
    if (!error.status) console.error(error);
  }
  return true;
}
