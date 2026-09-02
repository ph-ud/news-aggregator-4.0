import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKeys, deriveRecoveryAuth, newSalt, newMasterKey, newRecoveryKey, wrapMasterKey, unwrapMasterKey, wrapWithRecoveryKey, unwrapWithRecoveryKey, wrapWithPasskey, unwrapWithPasskey, encryptRecord, decryptRecord, randomId, formatRecoveryKey, toBase64, randomBytes } from '../src/crypto.js';

const ITERATIONS = 10000;
const derive = (pass, salt) => deriveKeys(pass, salt, { iterations: ITERATIONS });

test('the auth secret and the encryption key are independent', async () => {
  const salt = newSalt();
  const { authKey, kek } = await derive('reads2026shelf', salt);
  assert.notEqual(authKey, toBase64(kek), 'the server-visible secret must not equal the encryption key');
  const again = await derive('reads2026shelf', salt);
  assert.equal(again.authKey, authKey, 'derivation must be deterministic for the same passphrase and salt');
  const other = await derive('reads2026shelf', newSalt());
  assert.notEqual(other.authKey, authKey, 'a different salt must give a different secret');
});

test('a wrapped master key survives a round trip and resists a wrong passphrase', async () => {
  const salt = newSalt();
  const masterKey = newMasterKey();
  const { kek } = await derive('reads2026shelf', salt);
  const wrapped = await wrapMasterKey(kek, masterKey);
  assert.deepEqual([...(await unwrapMasterKey(kek, wrapped))], [...masterKey]);
  const { kek: wrongKek } = await derive('wrongpassphrase1', salt);
  await assert.rejects(() => unwrapMasterKey(wrongKek, wrapped), 'AES-GCM must reject a key that cannot authenticate the blob');
});

test('the recovery key is a second, independent path to the master key', async () => {
  const salt = newSalt();
  const masterKey = newMasterKey();
  const recoveryKey = newRecoveryKey();
  const wrapped = await wrapWithRecoveryKey(recoveryKey, masterKey);
  assert.deepEqual([...(await unwrapWithRecoveryKey(recoveryKey, wrapped))], [...masterKey]);
  await assert.rejects(() => unwrapWithRecoveryKey(newRecoveryKey(), wrapped));
  const auth = await deriveRecoveryAuth(recoveryKey, salt, { iterations: ITERATIONS });
  assert.notEqual(auth, recoveryKey, 'the server stores a derivative, never the recovery key itself');
});

test('records round-trip and never reuse an initialisation vector', async () => {
  const masterKey = newMasterKey();
  const record = { type: 'story', title: 'A city rethinks its streets', tags: ['cities'] };
  const first = await encryptRecord(masterKey, record);
  const second = await encryptRecord(masterKey, record);
  assert.deepEqual(await decryptRecord(masterKey, first), record);
  assert.notEqual(first.iv, second.iv, 'a repeated IV under one key breaks AES-GCM');
  assert.notEqual(first.ct, second.ct, 'identical plaintext must not produce identical ciphertext');
  await assert.rejects(() => decryptRecord(newMasterKey(), first));
});

test('tampering with ciphertext is detected rather than silently decrypted', async () => {
  const masterKey = newMasterKey();
  const payload = await encryptRecord(masterKey, { type: 'story', title: 'Original' });
  const flipped = [...atob(payload.ct)].map((char) => char.charCodeAt(0));
  flipped[0] ^= 0xff;
  const tampered = { iv: payload.iv, ct: btoa(String.fromCharCode(...flipped)) };
  await assert.rejects(() => decryptRecord(masterKey, tampered), 'GCM must reject a modified blob');
});

test('record ids carry no information about their content', () => {
  const ids = new Set(Array.from({ length: 500 }, randomId));
  assert.equal(ids.size, 500, 'ids must not collide');
  assert.equal([...ids].every((id) => /^[A-Za-z0-9_-]{22}$/.test(id)), true, 'ids must be a fixed length with no content-derived structure');
});

test('a recovery key survives being written down and typed back in', async () => {
  const key = newRecoveryKey();
  const formatted = formatRecoveryKey(key);
  assert.match(formatted, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){12}$/);
  /* The displayed form must convert back to the exact key, or recovery is impossible. */
  const masterKey = newMasterKey();
  const wrapped = await wrapWithRecoveryKey(key, masterKey);
  assert.deepEqual([...(await unwrapWithRecoveryKey(formatted, wrapped))], [...masterKey], 'the dashed form the reader copies must unwrap the key');
  assert.deepEqual([...(await unwrapWithRecoveryKey(formatted.toLowerCase(), wrapped))], [...masterKey], 'case must not matter when typing it back');
});

test('a passkey secret wraps the same master key a passphrase does', async () => {
  const masterKey = newMasterKey();
  /* What the authenticator returns from the PRF extension: 32 bytes, stable per credential. */
  const prf = randomBytes(32);
  const wrapped = await wrapWithPasskey(prf, masterKey);
  assert.deepEqual(await unwrapWithPasskey(prf, wrapped), masterKey);
  await assert.rejects(() => unwrapWithPasskey(randomBytes(32), wrapped), 'another passkey must not open it');
  /* Distinct wrappers of one key: adding a passkey never re-encrypts the library. */
  const kek = (await deriveKeys('correct horse 9', newSalt())).kek;
  assert.deepEqual(await unwrapMasterKey(kek, await wrapMasterKey(kek, masterKey)), masterKey);
});

test('a short PRF output is refused rather than silently padded', async () => {
  await assert.rejects(() => wrapWithPasskey(randomBytes(16), newMasterKey()), /usable secret/);
});
