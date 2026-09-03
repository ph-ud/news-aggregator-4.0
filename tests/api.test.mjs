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
  const recoveryKdfSalt = newSalt();
  const { authKey, kek } = await deriveKeys(passphrase, kdfSalt, { iterations: ITERATIONS });
  const masterKey = newMasterKey();
  const recoveryKey = newRecoveryKey();
  const response = await call('/api/auth/signup', { method: 'POST', body: {
    email, name, authKey, kdfSalt, recoveryKdfSalt, iterations: ITERATIONS,
    wrappedMk: await wrapMasterKey(kek, masterKey),
    recoveryWrap: await wrapWithRecoveryKey(recoveryKey, masterKey),
    recoveryAuthKey: await deriveRecoveryAuth(recoveryKey, recoveryKdfSalt, { iterations: ITERATIONS }),
  } });
  assert.equal(response.status, 201, `sign-up failed: ${JSON.stringify(response.body)}`);
  return { response, masterKey, recoveryKey, kdfSalt, recoveryKdfSalt };
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
  assert.equal(typeof unknown.body.recoverySalt, 'string');
  assert.ok(unknown.body.recoverySalt.length > 0, 'unknown emails must also receive a decoy recovery salt');
  assert.deepEqual(Object.keys(known.body).sort(), Object.keys(unknown.body).sort(), 'both responses must have the same shape');

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
  const recoveryAuthKey = await deriveRecoveryAuth(recoveryKey, saltInfo.recoverySalt, { iterations: saltInfo.recoveryIterations });
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

test('changing a passphrase re-wraps the same key and retires the old one', async () => {
  const call = client();
  const { masterKey, recoveryKey } = await enroll(call, 'rekey@example.com', 'reads2026shelf');

  /* Store something first: it must still decrypt afterwards, with no re-upload. */
  const id = randomId();
  await call('/api/records', { method: 'POST', body: { records: [{ id, ...(await encryptRecord(masterKey, { type: 'story', title: 'Survives a re-key' })) }] } });

  /* What the client does: unwrap with the old passphrase, re-wrap under the new one. */
  const { body: before } = await call('/api/auth/me');
  const { kek: oldKek } = await deriveKeys('reads2026shelf', before.kdfSalt, { iterations: before.iterations });
  const raw = await unwrapMasterKey(oldKek, before.wrappedMk);
  const nextSalt = newSalt();
  const { authKey: nextAuth, kek: nextKek } = await deriveKeys('brandnew2027key', nextSalt, { iterations: ITERATIONS });
  const rekeyed = await call('/api/auth/rekey', { method: 'POST', body: { authKey: nextAuth, kdfSalt: nextSalt, iterations: ITERATIONS, wrappedMk: await wrapMasterKey(nextKek, raw) } });
  assert.equal(rekeyed.status, 200);

  const fresh = client();
  const { body: salt } = await fresh('/api/auth/salt', { method: 'POST', body: { email: 'rekey@example.com' } });

  const { authKey: staleAuth } = await deriveKeys('reads2026shelf', salt.salt, { iterations: salt.iterations });
  assert.equal((await fresh('/api/auth/signin', { method: 'POST', body: { email: 'rekey@example.com', authKey: staleAuth } })).status, 401, 'the old passphrase must stop working');

  const { authKey, kek } = await deriveKeys('brandnew2027key', salt.salt, { iterations: salt.iterations });
  const signedIn = await fresh('/api/auth/signin', { method: 'POST', body: { email: 'rekey@example.com', authKey } });
  assert.equal(signedIn.status, 200, 'the new passphrase must work');
  assert.deepEqual([...(await unwrapMasterKey(kek, signedIn.body.wrappedMk))], [...masterKey], 'the master key itself must be unchanged');

  const rows = await fresh('/api/records');
  assert.equal((await decryptRecord(masterKey, rows.body.records.find((row) => row.id === id))).title, 'Survives a re-key', 'stored records must not need re-encrypting');

  /* The recovery key wraps the same master key, so it is untouched by a passphrase change. */
  const recoveryAuthKey = await deriveRecoveryAuth(recoveryKey, salt.recoverySalt, { iterations: salt.recoveryIterations });
  const recovered = await fresh('/api/auth/recover', { method: 'POST', body: { email: 'rekey@example.com', recoveryAuthKey } });
  assert.equal(recovered.status, 200, 'the recovery key must survive a passphrase change');
});

test('re-keying invalidates sessions on other devices', async () => {
  const first = client();
  await enroll(first, 'twodevice@example.com', 'reads2026shelf');
  const second = client();
  const { body: salt } = await second('/api/auth/salt', { method: 'POST', body: { email: 'twodevice@example.com' } });
  const { authKey, kek } = await deriveKeys('reads2026shelf', salt.salt, { iterations: salt.iterations });
  const signedIn = await second('/api/auth/signin', { method: 'POST', body: { email: 'twodevice@example.com', authKey } });
  assert.equal((await second('/api/records')).status, 200, 'the second device starts out signed in');

  const raw = await unwrapMasterKey(kek, signedIn.body.wrappedMk);
  const nextSalt = newSalt();
  const { authKey: nextAuth, kek: nextKek } = await deriveKeys('brandnew2027key', nextSalt, { iterations: ITERATIONS });
  await first('/api/auth/rekey', { method: 'POST', body: { authKey: nextAuth, kdfSalt: nextSalt, iterations: ITERATIONS, wrappedMk: await wrapMasterKey(nextKek, raw) } });

  assert.equal((await second('/api/records')).status, 401, 'the other device must be signed out');
  assert.equal((await first('/api/records')).status, 200, 'the device that changed it stays signed in');
});

test('rejects a re-key from a caller with no session', async () => {
  const anonymous = client();
  const salt = newSalt();
  const { authKey, kek } = await deriveKeys('brandnew2027key', salt, { iterations: ITERATIONS });
  const response = await anonymous('/api/auth/rekey', { method: 'POST', body: { authKey, kdfSalt: salt, iterations: ITERATIONS, wrappedMk: await wrapMasterKey(kek, newMasterKey()) } });
  assert.equal(response.status, 401);
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

  /* Trusted Types: every innerHTML assignment must go through the one named policy. */
  assert.equal(directives['require-trusted-types-for'], "'script'");
  assert.equal(directives['trusted-types'], 'reads-views', 'pinning the policy name stops injected script registering a permissive one');

  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const api = await fetch(`${base}/api/auth/me`);
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff', 'API responses need it too');
});

test('the served markup carries no inline event handlers', async () => {
  /* An inline handler would be dead code under this policy, so it must not creep back in. */
  const scripts = await Promise.all(['/app.js', '/src/store.js', '/src/crypto.js', '/src/credentials.js', '/src/passkeys.js', '/src/auth-tools.js'].map(async (path) => (await fetch(base + path)).text()));
  for (const source of scripts) assert.equal(/\son[a-z]+\s*=\s*["']/.test(source), false, 'markup built in JS must not contain inline handlers');
});

test('the application writes markup through exactly one guarded sink', async () => {
  const source = await (await fetch(`${base}/app.js`)).text();
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const sinks = code.match(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.write\(/g) || [];
  assert.equal(sinks.length, 1, `expected one sink, found ${sinks.length}: ${sinks.join(', ')}`);
  assert.match(code, /function paint\(view\)/, 'that sink is paint()');
  assert.match(code, /if \(!\(view instanceof SafeHtml\)\) throw/, 'paint() must reject anything not built by the html template');

  /* A pass-through policy would satisfy the CSP while protecting nothing. */
  assert.match(code, /createHTML: \(value, source\) =>/);
  assert.match(code, /source\.value !== value\) throw new TypeError/, 'the policy must verify provenance, not rubber-stamp');

  /* Manual escaping is gone: the template escapes by construction. */
  assert.equal(/\bescapeHtml\(/.test(code), false, 'views must not call escapeHtml; the html tag does it');
});

test('every view showing agent-written text says where that text came from', async () => {
  const source = await (await fetch(`${base}/app.js`)).text();
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const view = (name) => { const at = code.indexOf(`function ${name}(`); assert.notEqual(at, -1, `${name} must exist`); return code.slice(at, code.indexOf('\n', at)); };

  /* One helper builds the label, so a new card cannot quietly ship an unattributed variant. */
  assert.match(code, /function provenanceTag\(record\)/);
  for (const name of ['storyMeta', 'continueCard', 'creatorCard']) {
    assert.match(view(name), /provenanceTag\(/, `${name} renders agent-supplied prose and must attribute it`);
  }

  /* What the tool asks for and what the app stores must be one number, or a fuller summary
     gets requested and then silently truncated. */
  assert.match(code, /maxLength: SUMMARY_LIMIT/, 'the schema must advertise the limit the normalizer enforces');
  assert.match(code, /required: \['title', 'source', 'url', 'summary'\]/, 'a story with no summary has no readable text at all');
  assert.match(code, /80.150 words/, 'the tool must say how much summary it wants');

  /* Two pipelines now write stories, and a card that cannot say which is which lets a model's
     summary read as a publisher's own post. The badge comes from `via`, not from each view. */
  assert.match(code, /function provenanceTag\(record\)/);
  assert.match(code, /originBadge\(record\)/, 'the tag must show which pipeline delivered the record');
  assert.match(code, /provenanceLabel\(record\)/, 'and the wording must come from the shared helper');
  assert.equal(/Added by \$\{addedByLabel\(record\)\}/.test(code), false, 'a feed entry is not "added by" an assistant');

  /* The reader page makes a claim about who wrote the text below it, so it must branch. */
  assert.match(code, /const fromFeed = isFromFeed\(story\)/, 'readerView must know which pipeline it is rendering');
  assert.match(code, /class="article-notice article-notice-rss"/, 'a feed entry needs its own notice');
  assert.match(code, /own feed entry, not a summary of it/, 'and that notice must not call it an assistant\'s summary');

  /* The Subscriptions tab is the posts from people the reader follows. An injection landing
     there would put a model's summary among them, so the tab filters and the injection moves. */
  assert.match(code, /if \(state\.activeFolder === 'rss'\) return sortStoriesByDate\(stories\.filter\(isFromFeed\)\)/, 'the subscriptions tab reads feed entries only');
  assert.match(code, /const wasOnSubscriptions = state\.activeFolder === 'rss'/, 'an injection must notice it is on the subscriptions tab');
  assert.match(code, /state\.activeFolder = wasOnSubscriptions \? 'ai' :/, 'and send its results to AI finds instead of into the feed tab');
  assert.match(code, /data-action="open-subscriptions"/, 'the subscriptions tab must be reachable from the nav');

  /* Nothing in the page may fetch a feed: that is the reader's own machine's job. */
  assert.equal(/fetch\(\s*(?:feed|entry|subscription)/i.test(code), false, 'the page must never fetch a feed itself');

  /* The reader page is the one that reads like an article, so it must be explicit. */
  assert.match(code, /class="article-notice"/, 'the reader page must state that the body is a summary');
  assert.match(code, /never fetches or stores article text/);
  assert.equal(/A source-preserved entry from/.test(code), false, 'the dek must not present the summary as the source\'s own entry');
  assert.equal(/12 min read/.test(code), false, 'a read time for a 420-character summary claims text we never had');
});
