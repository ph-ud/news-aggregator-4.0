import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredential, verifyCredential, validateEmail, validatePassphrase, accountId, scopedKey, publicProfile } from '../src/account.js';

test('validates email addresses and normalizes casing', () => {
  assert.equal(validateEmail('  Reader@Example.COM '), 'reader@example.com');
  assert.equal(validateEmail('not-an-email'), '');
  assert.equal(validateEmail(null), '');
});

test('requires a passphrase with letters, numbers, and length', () => {
  assert.equal(validatePassphrase('short1').ok, false);
  assert.equal(validatePassphrase('alllettershere').ok, false);
  assert.equal(validatePassphrase('reads2026shelf').ok, true);
});

test('creates a credential that never stores the passphrase and verifies it', async () => {
  const account = await createCredential('Reader@Example.com', 'reads2026shelf', ' Ada  Reader ');
  assert.equal(account.email, 'reader@example.com');
  assert.equal(account.name, 'Ada Reader');
  assert.equal(account.id, accountId('reader@example.com'));
  assert.equal(JSON.stringify(account).includes('reads2026shelf'), false);
  assert.equal(await verifyCredential(account, 'reads2026shelf'), true);
  assert.equal(await verifyCredential(account, 'reads2026shelG'), false);
  assert.equal(await verifyCredential(null, 'reads2026shelf'), false);
});

test('rejects weak or malformed sign-up input', async () => {
  await assert.rejects(() => createCredential('nope', 'reads2026shelf'), /valid email/);
  await assert.rejects(() => createCredential('reader@example.com', 'weak'), /8 characters/);
});

test('scopes storage keys per account and exposes no secrets in the profile', async () => {
  const account = await createCredential('reader@example.com', 'reads2026shelf', 'Ada');
  const other = await createCredential('other@example.com', 'reads2026shelf', 'Bo');
  assert.notEqual(scopedKey(account.id, 'library'), scopedKey(other.id, 'library'));
  assert.deepEqual(Object.keys(publicProfile(account)).sort(), ['createdAt', 'email', 'id', 'name']);
  assert.equal(publicProfile(null), null);
});
