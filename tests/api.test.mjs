import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveKeys, deriveRecoveryAuth, newSalt, newMasterKey, newRecoveryKey, wrapMasterKey, unwrapMasterKey, wrapWithRecoveryKey, unwrapWithRecoveryKey, encryptRecord, decryptRecord, randomId } from '../src/crypto.js';

/* The server's floor. Production uses 600k; this keeps the suite quick while still
   exercising the real constraint rather than a relaxed one. */
const ITERATIONS = 100000;
const workDir = mkdtempSync(join(tmpdir(), '4reads-'));
const dbPath = join(workDir, 'test.db');
let base = '';
let child;

test.before(async () => {
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: '0', DATABASE_PATH: dbPath, SESSION_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { const match = /http:\/\/localhost:(\d+)/.exec(String(chunk)); if (match) resolve(`http://localhost:${match[1]}`); });
    child.stderr.on('data', (chunk) => { const text = String(chunk); if (!/Warning|trace-warnings/.test(text)) reject(new Error(text)); });
    setTimeout(() => reject(new Error('server did not start')), 10000);
  });
});
test.after(() => { child?.kill(); rmSync(workDir, { recursive: true, force: true }); });

/** Minimal cookie jar: node's fetch does not persist Set-Cookie between calls. */
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.getSetCookie?.()[0];
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
}

/** Everything the client does before it is allowed to talk to the server. */
async function enroll(call, email, passphrase, name = 'Reader') {
  const kdfSalt = newSalt();
  const { authKey, kek } = await deriveKeys(passphrase, kdfSalt, { iterations: ITERATIONS });
  const masterKey = newMasterKey();
  const recoveryKey = newRecoveryKey();
  const response = await call('/api/auth/signup', { method: 'POST', body: {
    email, name, authKey, kdfSalt, iterations: ITERATIONS,
    wrappedMk: await wrapMasterKey(kek, masterKey),
    recoveryWrap: await wrapWithRecoveryKey(recoveryKey, masterKey),
    recoveryAuthKey: await deriveRecoveryAuth(recoveryKey, kdfSalt, { iterations: ITERATIONS }),
  } });
  assert.equal(response.status, 201, `sign-up failed: ${JSON.stringify(response.body)}`);
  return { response, masterKey, recoveryKey, kdfSalt };
}

test('signs up, signs back in, and recovers the same master key', async () => {
  const call = client();
  const { response, masterKey } = await enroll(call, 'ada@example.com', 'reads2026shelf');
  assert.equal(response.status, 201);

  const fresh = client();
  const { body: saltInfo } = await fresh('/api/auth/salt', { method: 'POST', body: { email: 'ada@example.com' } });
  const { authKey, kek } = await deriveKeys('reads2026shelf', saltInfo.salt, { iterations: saltInfo.iterations });
  const { status, body } = await fresh('/api/auth/signin', { method: 'POST', body: { email: 'ada@example.com', authKey } });
  assert.equal(status, 200);
  const unwrapped = await unwrapMasterKey(kek, body.wrappedMk);
  assert.deepEqual([...unwrapped], [...masterKey], 'sign-in must recover the exact master key');
});

test('rejects a wrong passphrase without revealing whether the account exists', async () => {
  const call = client();
  await enroll(call, 'bo@example.com', 'reads2026shelf');

  const probe = client();
  const known = await probe('/api/auth/salt', { method: 'POST', body: { email: 'bo@example.com' } });
  const unknown = await probe('/api/auth/salt', { method: 'POST', body: { email: 'ghost@example.com' } });
  assert.equal(known.status, unknown.status);
  assert.equal(typeof unknown.body.salt, 'string');
  assert.equal(unknown.body.salt.length > 0, true, 'unknown emails must still receive a salt');
  assert.notEqual(known.body.salt, unknown.body.salt);

  const { authKey } = await deriveKeys('wrongpassphrase1', known.body.salt, { iterations: ITERATIONS });
  const bad = await probe('/api/auth/signin', { method: 'POST', body: { email: 'bo@example.com', authKey } });
  const missing = await probe('/api/auth/signin', { method: 'POST', body: { email: 'ghost@example.com', authKey } });
  assert.equal(bad.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(bad.body.error, missing.body.error, 'both failures must read identically');
});

test('a recovery key unwraps the master key when the passphrase is gone', async () => {
  const call = client();
  const { masterKey, recoveryKey } = await enroll(call, 'cleo@example.com', 'reads2026shelf');
  const fresh = client();
  const { body: saltInfo } = await fresh('/api/auth/salt', { method: 'POST', body: { email: 'cleo@example.com' } });
  const recoveryAuthKey = await deriveRecoveryAuth(recoveryKey, saltInfo.salt, { iterations: saltInfo.iterations });
  const { status, body } = await fresh('/api/auth/recover', { method: 'POST', body: { email: 'cleo@example.com', recoveryAuthKey } });
  assert.equal(status, 200);
  assert.deepEqual([...(await unwrapWithRecoveryKey(recoveryKey, body.recoveryWrap))], [...masterKey]);

  const wrong = await fresh('/api/auth/recover', { method: 'POST', body: { email: 'cleo@example.com', recoveryAuthKey: 'AAAA' } });
  assert.equal(wrong.status, 401);
});

test('records are private to their account and require a session', async () => {
  const ada = client();
  const { masterKey } = await enroll(ada, 'ada2@example.com', 'reads2026shelf');
  const record = { id: randomId(), type: 'story', title: 'Private to Ada', addedAt: new Date().toISOString() };
  const stored = await ada('/api/records', { method: 'POST', body: { records: [{ id: record.id, ...(await encryptRecord(masterKey, record)) }] } });
  assert.equal(stored.status, 200);

  const bo = client();
  await enroll(bo, 'bo2@example.com', 'reads2026shelf');
  const theirs = await bo('/api/records');
  assert.equal(theirs.body.records.length, 0, 'a second account must not see the first account\'s rows');

  const anonymous = client();
  assert.equal((await anonymous('/api/records')).status, 401);
  assert.equal((await anonymous('/api/records', { method: 'POST', body: { records: [] } })).status, 401);

  const mine = await ada('/api/records');
  assert.equal((await decryptRecord(masterKey, mine.body.records[0])).title, 'Private to Ada');
});

test('the database on disk contains no readable library content', async () => {
  const call = client();
  const { masterKey } = await enroll(call, 'vault@example.com', 'reads2026shelf');
  const secrets = {
    title: 'ZEBRAFISH-CANARY-TITLE',
    host: 'zebrafish-canary-host.example',
    summary: 'ZEBRAFISH-CANARY-SUMMARY',
  };
  const written = await call('/api/records', { method: 'POST', body: { records: [
    { id: randomId(), ...(await encryptRecord(masterKey, { type: 'story', title: secrets.title, summary: secrets.summary, url: `https://${secrets.host}/a` })) },
    { id: randomId(), ...(await encryptRecord(masterKey, { type: 'subscription', name: secrets.title, host: secrets.host })) },
  ] } });
  assert.equal(written.status, 200, 'the rows must actually be stored, or this test proves nothing');
  const stored = await call('/api/records');
  assert.equal(stored.body.records.length, 2, 'both records must be readable back by their owner');
  assert.equal((await decryptRecord(masterKey, stored.body.records[0])).title, secrets.title);

  const dump = readFileSync(dbPath).toString('latin1');
  const wal = (() => { try { return readFileSync(`${dbPath}-wal`).toString('latin1'); } catch { return ''; } })();
  for (const [label, needle] of Object.entries(secrets)) {
    assert.equal(dump.includes(needle), false, `${label} must not appear in the database file`);
    assert.equal(wal.includes(needle), false, `${label} must not appear in the write-ahead log`);
  }
  /* The passphrase must not be derivable from anything stored either. */
  assert.equal(dump.includes('reads2026shelf'), false, 'the passphrase must never reach the server');
});

test('serves a content security policy that denies by default', async () => {
  const response = await fetch(`${base}/`);
  const policy = response.headers.get('content-security-policy');
  assert.ok(policy, 'the document must carry a policy');
  const directives = Object.fromEntries(policy.split(';').map((part) => { const [name, ...values] = part.trim().split(/\s+/); return [name, values.join(' ')]; }));

  assert.equal(directives['default-src'], "'none'", 'start from deny-all so a new resource type is not silently allowed');
  assert.equal(directives['script-src'], "'self'", 'no inline script, no third-party script');
  assert.equal(directives['base-uri'], "'none'", 'an injected <base> would retarget every relative module import');
  assert.equal(directives['form-action'], "'none'", 'an injected form must not be able to post a passphrase away');
  assert.equal(directives['frame-ancestors'], "'none'");
  assert.equal(directives['connect-src'], "'self'", 'decrypted content must not be postable to another origin');
  /* Deliberate concessions: inline style attributes, and images the agent chooses. */
  assert.match(directives['style-src'], /'unsafe-inline'/);
  assert.match(directives['img-src'], /https:/);
  assert.equal(/'unsafe-inline'|'unsafe-eval'/.test(directives['script-src']), false, 'script-src must never be relaxed');

  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const api = await fetch(`${base}/api/auth/me`);
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff', 'API responses need it too');
});

test('the served markup carries no inline event handlers', async () => {
  /* An inline handler would be dead code under this policy, so it must not creep back in. */
  const scripts = await Promise.all(['/app.js', '/src/store.js', '/src/crypto.js'].map(async (path) => (await fetch(base + path)).text()));
  for (const source of scripts) assert.equal(/\son[a-z]+\s*=\s*["']/.test(source), false, 'markup built in JS must not contain inline handlers');
});
