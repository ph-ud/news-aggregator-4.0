import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollPasskey, unlockWithPasskey, passkeysSupported } from '../src/passkeys.js';
import { newMasterKey, wrapWithPasskey, randomBytes, toBase64 } from '../src/crypto.js';

const b64url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CHALLENGE = b64url(randomBytes(32));

/** A browser with an authenticator, reduced to what this module asks of it. */
function scopeWith({ prfEnabled = true, prfSecret = randomBytes(32), prfAtCreate = false, assertionSecret = prfSecret } = {}) {
  const calls = { create: [], get: [] };
  const response = (bytes = 32) => ({
    clientDataJSON: randomBytes(bytes), signature: randomBytes(70),
    authenticatorData: randomBytes(37), getAuthenticatorData: () => randomBytes(37),
    getPublicKey: () => randomBytes(91), getPublicKeyAlgorithm: () => -7,
  });
  return {
    calls, prfSecret,
    crypto: globalThis.crypto,
    PublicKeyCredential: class {},
    navigator: { credentials: {
      create: async (options) => {
        calls.create.push(options);
        return { id: 'credential-1', rawId: randomBytes(16), response: response(),
          getClientExtensionResults: () => ({ prf: { enabled: prfEnabled, ...(prfAtCreate ? { results: { first: prfSecret } } : {}) } }) };
      },
      get: async (options) => {
        calls.get.push(options);
        return { id: 'credential-1', rawId: randomBytes(16), response: response(),
          getClientExtensionResults: () => ({ prf: assertionSecret ? { results: { first: assertionSecret } } : {} }) };
      },
    } },
  };
}

function apiWith(responses) {
  const sent = [];
  return { sent, api: async (path, options = {}) => { sent.push({ path, body: options.body }); return responses[path] ?? {}; } };
}

const setup = { challenge: CHALLENGE, rpId: 'localhost', userId: b64url(new TextEncoder().encode('user-1')), userName: 'ada@example.com', userDisplayName: 'Ada', existing: [] };

test('a browser without WebAuthn is told so rather than failing obscurely', async () => {
  const bare = { navigator: { credentials: {} } };
  assert.equal(passkeysSupported(bare), false);
  await assert.rejects(() => enrollPasskey({ api: async () => setup, rawMasterKey: newMasterKey(), scope: bare }), /cannot create passkeys/);
  await assert.rejects(() => unlockWithPasskey({ api: async () => setup, scope: bare }), /cannot use passkeys/);
});

test('enrolling asks for a discoverable, verified credential and registers what the server checks', async () => {
  const scope = scopeWith();
  const { api, sent } = apiWith({ '/api/auth/passkey/challenge': setup, '/api/auth/passkey/register': { ok: true, passkeys: [{ id: 'credential-1' }] } });
  await enrollPasskey({ api, rawMasterKey: newMasterKey(), scope });

  const asked = scope.calls.create[0].publicKey;
  assert.equal(asked.authenticatorSelection.residentKey, 'required', 'unlocking must not need an email');
  assert.equal(asked.authenticatorSelection.userVerification, 'required', 'a person must be verified, not merely present');
  assert.equal(asked.attestation, 'none');
  assert.deepEqual(asked.extensions, { prf: {} });

  const registered = sent.find((call) => call.path === '/api/auth/passkey/register').body;
  assert.equal(registered.challenge, CHALLENGE, 'the server must be able to tie this to its own challenge');
  assert.deepEqual(Object.keys(registered).sort(), ['algorithm', 'authenticatorData', 'challenge', 'clientDataJSON', 'credentialId', 'publicKey', 'wrappedMk'].sort());
  assert.equal(typeof registered.wrappedMk.ct, 'string');
});

test('the wrapped key it registers is one only that passkey can open', async () => {
  const scope = scopeWith();
  const masterKey = newMasterKey();
  const { api, sent } = apiWith({ '/api/auth/passkey/challenge': setup });
  await enrollPasskey({ api, rawMasterKey: masterKey, scope });
  const { wrappedMk } = sent.find((call) => call.path === '/api/auth/passkey/register').body;

  const { api: unlockApi } = apiWith({ '/api/auth/passkey/challenge': setup, '/api/auth/passkey/assert': { profile: { name: 'Ada' }, wrappedMk } });
  const unlocked = await unlockWithPasskey({ api: unlockApi, scope: scopeWith({ prfSecret: scope.prfSecret }) });
  assert.deepEqual(unlocked.masterKey, masterKey);
  assert.equal(unlocked.profile.name, 'Ada');
});

test('a passkey that cannot hold a secret is refused before anything is registered', async () => {
  const scope = scopeWith({ prfEnabled: false });
  const { api, sent } = apiWith({ '/api/auth/passkey/challenge': setup });
  await assert.rejects(() => enrollPasskey({ api, rawMasterKey: newMasterKey(), scope }), /cannot hold an encryption secret/);
  assert.equal(sent.some((call) => call.path === '/api/auth/passkey/register'), false, 'a passkey that cannot unlock must not be registered');
});

test('a platform that returns the secret from create() is not asked to verify twice', async () => {
  const scope = scopeWith({ prfAtCreate: true });
  await enrollPasskey({ api: apiWith({ '/api/auth/passkey/challenge': setup }).api, rawMasterKey: newMasterKey(), scope });
  assert.equal(scope.calls.get.length, 0, 'one fingerprint prompt, not two');
});

test('unlocking names no account and asks for the secret by salt', async () => {
  const scope = scopeWith();
  const wrappedMk = await wrapWithPasskey(scope.prfSecret, newMasterKey());
  const { api } = apiWith({ '/api/auth/passkey/challenge': setup, '/api/auth/passkey/assert': { profile: { name: 'Ada' }, wrappedMk } });
  await unlockWithPasskey({ api, scope });
  const asked = scope.calls.get[0].publicKey;
  assert.deepEqual(asked.allowCredentials, [], 'the credential names its own account');
  assert.equal(asked.userVerification, 'required');
  assert.ok(asked.extensions.prf.eval.first, 'the PRF salt must be evaluated or there is no key');
});

test('a wrapper this passkey cannot open is a refusal, not a broken library', async () => {
  const scope = scopeWith();
  /* What a tampering or confused server would return: someone else's blob. */
  const wrappedMk = await wrapWithPasskey(randomBytes(32), newMasterKey());
  const { api } = apiWith({ '/api/auth/passkey/challenge': setup, '/api/auth/passkey/assert': { profile: { name: 'Ada' }, wrappedMk } });
  await assert.rejects(() => unlockWithPasskey({ api, scope }), /did not open your library/);
});

test('an assertion without a PRF result stops before the server is asked', async () => {
  const scope = scopeWith({ assertionSecret: null });
  const { api, sent } = apiWith({ '/api/auth/passkey/challenge': setup });
  await assert.rejects(() => unlockWithPasskey({ api, scope }), /cannot open your library/);
  assert.equal(sent.some((call) => call.path === '/api/auth/passkey/assert'), false);
});
