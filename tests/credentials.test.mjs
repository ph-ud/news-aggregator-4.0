import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialsAvailable, rememberCredential, savedCredential, forgetSilentAccess, RETRIEVAL_MEDIATION } from '../src/credentials.js';

/** A browser with a password store. `behaviour` stands in for what the store does. */
function scopeWith({ get = async () => null, store = async () => {}, preventSilentAccess = async () => {} } = {}) {
  const calls = { get: [], store: [], prevented: 0 };
  return {
    calls,
    PasswordCredential: class { constructor({ id, password, name }) { Object.assign(this, { id, password, name, type: 'password' }); } },
    navigator: { credentials: {
      get: async (options) => { calls.get.push(options); return get(options); },
      store: async (credential) => { calls.store.push(credential); return store(credential); },
      preventSilentAccess: async () => { calls.prevented += 1; return preventSilentAccess(); },
    } },
  };
}

/* Exactly what headless Chromium does: the constructor exists, the store does not. */
const unsupported = () => { throw Object.assign(new Error('The user agent does not support public key credentials.'), { name: 'NotSupportedError' }); };

test('a browser without a password store is simply a browser without one', async () => {
  for (const scope of [{}, { PasswordCredential: class {} }, { navigator: { credentials: {} } }]) {
    assert.equal(credentialsAvailable(scope), false);
    assert.equal(await rememberCredential({ email: 'a@b.c', passphrase: 'hunter2 9' }, scope), 'unsupported');
    assert.equal(await savedCredential(scope), null);
    await forgetSilentAccess(scope);
  }
});

test('a saved credential is offered to the manager under the account email', async () => {
  const scope = scopeWith();
  assert.equal(credentialsAvailable(scope), true);
  assert.equal(await rememberCredential({ email: 'reader@example.com', name: 'Ada', passphrase: 'correct horse 9' }, scope), 'stored');
  assert.deepEqual({ ...scope.calls.store[0] }, { id: 'reader@example.com', password: 'correct horse 9', name: 'Ada', type: 'password' });
});

test('nothing is offered without both an identity and a passphrase', async () => {
  const scope = scopeWith();
  assert.equal(await rememberCredential({ email: '', passphrase: 'correct horse 9' }, scope), 'unsupported');
  assert.equal(await rememberCredential({ email: 'reader@example.com', passphrase: '' }, scope), 'unsupported');
  assert.equal(scope.calls.store.length, 0);
});

test('a store that rejects never breaks the sign-in that triggered it', async () => {
  const scope = scopeWith({ store: unsupported });
  assert.equal(await rememberCredential({ email: 'a@b.c', passphrase: 'hunter2 9' }, scope), 'failed');
});

test('retrieval asks for the account chooser rather than a silent hand-over', async () => {
  const scope = scopeWith({ get: async () => ({ id: 'reader@example.com', password: 'correct horse 9' }) });
  assert.deepEqual(await savedCredential(scope), { email: 'reader@example.com', passphrase: 'correct horse 9' });
  assert.deepEqual(scope.calls.get[0], { password: true, mediation: RETRIEVAL_MEDIATION });
  assert.notEqual(RETRIEVAL_MEDIATION, 'silent', 'a credential must never arrive without the reader asking');
});

test('anything that is not a usable password means "type it instead"', async () => {
  const cases = {
    'nothing saved': async () => null,
    'the reader dismissed the chooser': unsupported,
    /* A passkey or federated entry: an identity with no password to derive a key from. */
    'a credential with no password': async () => ({ id: 'reader@example.com' }),
    'a credential with an empty password': async () => ({ id: 'reader@example.com', password: '' }),
    'a credential with no identity': async () => ({ password: 'correct horse 9' }),
  };
  for (const [label, get] of Object.entries(cases)) {
    assert.equal(await savedCredential(scopeWith({ get })), null, label);
  }
});

test('signing out stops the browser handing the next load a credential', async () => {
  const scope = scopeWith();
  await forgetSilentAccess(scope);
  assert.equal(scope.calls.prevented, 1);
  await forgetSilentAccess(scopeWith({ preventSilentAccess: unsupported }));
});
