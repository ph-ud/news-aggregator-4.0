/**
 * Passkey unlock: the browser holds the credential, the authenticator holds the secret.
 *
 * A passkey is the one credential an agentic browser cannot use on the reader's behalf.
 * Unlocking requires user verification — a fingerprint, a face, a device PIN — and the PRF
 * secret that decrypts the library is computed inside the authenticator, handed only to this
 * origin, and never stored anywhere we or the browser vendor can reach.
 *
 * The credential is discoverable, so unlocking needs no email: the assertion says which
 * account it belongs to. Everything the server receives — public key, signature, wrapped
 * master key — is either public or opaque to it.
 */
import { PASSKEY_PRF_SALT, wrapWithPasskey, unwrapWithPasskey, toBase64 } from './crypto.js';

const RP_NAME = '4.0-reads';
const toB64url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (value) => {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)), (char) => char.charCodeAt(0));
};

export function passkeysSupported(scope = globalThis) {
  return typeof scope.PublicKeyCredential === 'function' && Boolean(scope.navigator?.credentials?.create);
}

/** The PRF result lives in a different place after create() than after get(). */
const prfResult = (credential) => credential.getClientExtensionResults?.()?.prf?.results?.first || null;

/**
 * Enrol a passkey as a second way into the same master key.
 *
 * Needs the raw master key, which after a reload is a non-extractable CryptoKey — so the
 * caller has to unwrap it with the passphrase first, exactly as a re-key does. Enrolling
 * re-encrypts nothing: it adds one more wrapper, like the recovery key.
 */
export async function enrollPasskey({ api, rawMasterKey, scope = globalThis }) {
  if (!passkeysSupported(scope)) throw new Error('This browser cannot create passkeys.');
  const setup = await api('/api/auth/passkey/challenge', { method: 'POST', body: { purpose: 'register' } });
  const credential = await scope.navigator.credentials.create({ publicKey: {
    challenge: fromB64url(setup.challenge),
    rp: { id: setup.rpId, name: RP_NAME },
    user: { id: fromB64url(setup.userId), name: setup.userName, displayName: setup.userDisplayName },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    /* Discoverable so that unlocking needs no email, verified so that a person must be present. */
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: (setup.existing || []).map((id) => ({ type: 'public-key', id: fromB64url(id) })),
    attestation: 'none',
    extensions: { prf: {} },
  } });
  if (!credential) throw new Error('No passkey was created.');
  if (!credential.getClientExtensionResults?.()?.prf?.enabled) {
    throw new Error('This device\'s passkeys cannot hold an encryption secret, so one could not unlock your library. Keep using your passphrase.');
  }

  /* Some platforms return the secret from create(); the rest need one assertion for it,
     which is why enrolling can ask for a fingerprint twice. */
  const secret = prfResult(credential) || await evaluatePrf({ scope, rpId: setup.rpId, credentialId: credential.rawId });
  const wrappedMk = await wrapWithPasskey(secret, rawMasterKey);

  return api('/api/auth/passkey/register', { method: 'POST', body: {
    challenge: setup.challenge,
    credentialId: credential.id,
    publicKey: toBase64(credential.response.getPublicKey()),
    algorithm: credential.response.getPublicKeyAlgorithm(),
    clientDataJSON: toB64url(credential.response.clientDataJSON),
    authenticatorData: toB64url(credential.response.getAuthenticatorData()),
    wrappedMk,
  } });
}

/** A local assertion purely to read the PRF secret; the server never sees this one. */
async function evaluatePrf({ scope, rpId, credentialId }) {
  const assertion = await scope.navigator.credentials.get({ publicKey: {
    challenge: scope.crypto.getRandomValues(new Uint8Array(32)),
    rpId, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: credentialId }],
    extensions: { prf: { eval: { first: PASSKEY_PRF_SALT } } },
  } });
  const secret = assertion && prfResult(assertion);
  if (!secret) throw new Error('That passkey did not return an encryption secret.');
  return secret;
}

/**
 * Unlock with a passkey. Returns the profile and the raw master key; the caller adopts them
 * the same way a passphrase sign-in does.
 */
export async function unlockWithPasskey({ api, scope = globalThis }) {
  if (!passkeysSupported(scope)) throw new Error('This browser cannot use passkeys.');
  const { challenge, rpId } = await api('/api/auth/passkey/challenge', { method: 'POST', body: { purpose: 'unlock' } });
  const assertion = await scope.navigator.credentials.get({ publicKey: {
    challenge: fromB64url(challenge),
    rpId, userVerification: 'required',
    /* Empty: the credential names its own account, so the reader types nothing. */
    allowCredentials: [],
    extensions: { prf: { eval: { first: PASSKEY_PRF_SALT } } },
  } });
  if (!assertion) throw new Error('No passkey was offered.');
  const secret = prfResult(assertion);
  if (!secret) throw new Error('That passkey cannot open your library. Sign in with your passphrase.');

  const { profile, wrappedMk } = await api('/api/auth/passkey/assert', { method: 'POST', body: {
    challenge,
    credentialId: assertion.id,
    clientDataJSON: toB64url(assertion.response.clientDataJSON),
    authenticatorData: toB64url(assertion.response.authenticatorData),
    signature: toB64url(assertion.response.signature),
  } });
  /* A server that returned someone else's blob, or a tampered one, fails here rather than
     handing back a library: only this authenticator's secret opens this wrapper. */
  const masterKey = await unwrapWithPasskey(secret, wrappedMk).catch(() => { throw new Error('That passkey did not open your library.'); });
  return { profile, masterKey };
}
