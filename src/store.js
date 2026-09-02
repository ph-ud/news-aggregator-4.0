import { normalizeRecoveryKey, deriveKeys, deriveRecoveryAuth, newSalt, newMasterKey, newRecoveryKey, wrapMasterKey, unwrapMasterKey, wrapWithRecoveryKey, unwrapWithRecoveryKey, importMasterKey, encryptRecord, decryptRecord, randomId, KDF } from './crypto.js';
import { enrollPasskey, unlockWithPasskey } from './passkeys.js';
import { rememberKey, recallKey, forgetKeys } from './keystore.js';

const TYPES = { story: 'stories', creator: 'creators', subscription: 'subscriptions', folder: 'folders', saved: 'saved' };
const emptyLibrary = () => ({ stories: [], creators: [], subscriptions: [], folders: [], saved: [], settings: { theme: 'paper', fontScale: 1 } });

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The server rejected that request.');
  return payload;
}

export const store = {
  profile: null,
  masterKey: null,
  pendingRaw: null,
  library: emptyLibrary(),
  records: new Map(),
  syncedAt: '',
  passkeys: [],

  get signedIn() { return Boolean(this.profile && this.masterKey); },

  /* ---------- credentials ---------- */
  async signUp({ name, email, passphrase }) {
    const kdfSalt = newSalt();
    /* Its own salt, so that changing the passphrase later cannot invalidate the recovery key. */
    const recoveryKdfSalt = newSalt();
    const { authKey, kek } = await deriveKeys(passphrase, kdfSalt);
    const masterKey = newMasterKey();
    const recoveryKey = newRecoveryKey();
    const [wrappedMk, recoveryWrap, recoveryAuthKey] = await Promise.all([
      wrapMasterKey(kek, masterKey),
      wrapWithRecoveryKey(recoveryKey, masterKey),
      deriveRecoveryAuth(recoveryKey, recoveryKdfSalt),
    ]);
    const { profile } = await api('/api/auth/signup', { method: 'POST', body: { email, name, authKey, kdfSalt, recoveryKdfSalt, iterations: KDF.iterations, wrappedMk, recoveryWrap, recoveryAuthKey } });
    await this.adopt(profile, masterKey);
    return { recoveryKey };
  },

  async signIn({ email, passphrase }) {
    const { salt, iterations } = await api('/api/auth/salt', { method: 'POST', body: { email } });
    const { authKey, kek } = await deriveKeys(passphrase, salt, { iterations });
    const { profile, wrappedMk } = await api('/api/auth/signin', { method: 'POST', body: { email, authKey } });
    /* A decoy salt gets this far and fails here: the server cannot tell us the passphrase was wrong. */
    const masterKey = await unwrapMasterKey(kek, wrappedMk).catch(() => { throw new Error('Those credentials do not match an account.'); });
    await this.adopt(profile, masterKey);
    await this.loadPasskeys();
    await this.pull();
  },

  async recover({ email, recoveryKey }) {
    const { recoverySalt, recoveryIterations } = await api('/api/auth/salt', { method: 'POST', body: { email } });
    const recoveryAuthKey = await deriveRecoveryAuth(recoveryKey, recoverySalt, { iterations: recoveryIterations });
    const { profile, recoveryWrap } = await api('/api/auth/recover', { method: 'POST', body: { email, recoveryAuthKey } });
    const masterKey = await unwrapWithRecoveryKey(recoveryKey, recoveryWrap).catch(() => { throw new Error('That recovery key does not match an account.'); });
    await this.adopt(profile, masterKey);
    /* Held only until a new passphrase is chosen: the old one is forgotten by definition. */
    this.pendingRaw = masterKey;
    await this.pull();
  },

  /**
   * Re-wrap the master key under a new passphrase. The key itself never changes, so nothing
   * stored needs re-encrypting and the recovery key stays valid.
   *
   * The current passphrase is required and is verified by actually unwrapping the master key,
   * not by asking the server — a compromised server cannot wave this through. It is also the
   * only way to obtain the raw key bytes at all: after a reload the in-memory key is a
   * non-extractable CryptoKey, deliberately impossible to read back.
   *
   * The exception is the moment just after recovery, when there is no current passphrase to
   * give and the raw key is still in hand from unwrapping it with the recovery key.
   */
  async changePassphrase({ current, next }) {
    if (!this.profile) throw new Error('Sign in first.');
    const raw = await this.rawMasterKey(current);
    const kdfSalt = newSalt();
    const { authKey, kek } = await deriveKeys(next, kdfSalt);
    const wrappedMk = await wrapMasterKey(kek, raw);
    /* The server drops every session for this account, so other devices must sign in again. */
    await api('/api/auth/rekey', { method: 'POST', body: { authKey, kdfSalt, iterations: KDF.iterations, wrappedMk } });
    this.pendingRaw = null;
  },

  /**
   * The raw master key bytes, which only the passphrase can produce: after a reload the
   * in-memory key is a non-extractable CryptoKey. Verified by actually unwrapping, never by
   * asking the server, so a compromised server cannot wave the check through. Both things
   * that add a wrapper — a re-key and enrolling a passkey — go through here.
   */
  async rawMasterKey(current) {
    if (this.pendingRaw) return this.pendingRaw;
    if (!current) throw new Error('Enter your current passphrase.');
    const { wrappedMk, kdfSalt, iterations } = await api('/api/auth/me');
    const { kek } = await deriveKeys(current, kdfSalt, { iterations });
    return unwrapMasterKey(kek, wrappedMk).catch(() => { throw new Error('That is not your current passphrase.'); });
  },

  /* ---------- passkeys ---------- */

  /** Adds one more wrapper around the same master key. Nothing is re-encrypted. */
  async addPasskey({ current }) {
    if (!this.profile) throw new Error('Sign in first.');
    const { passkeys } = await enrollPasskey({ api, rawMasterKey: await this.rawMasterKey(current) });
    this.passkeys = passkeys || [];
    return this.passkeys;
  },

  async signInWithPasskey() {
    const { profile, masterKey } = await unlockWithPasskey({ api });
    await this.adopt(profile, masterKey);
    await this.loadPasskeys();
    await this.pull();
  },

  async removePasskey(credentialId) {
    const { passkeys } = await api('/api/auth/passkey/remove', { method: 'POST', body: { credentialId } });
    this.passkeys = passkeys || [];
    return this.passkeys;
  },

  async loadPasskeys() {
    const { passkeys } = await api('/api/auth/me').catch(() => ({}));
    this.passkeys = passkeys || [];
    return this.passkeys;
  },

  /** True only between recovering an account and choosing its new passphrase. */
  get needsNewPassphrase() { return Boolean(this.pendingRaw); },

  async restore() {
    const payload = await api('/api/auth/me');
    const { signedIn, profile } = payload;
    if (!signedIn) return false;
    const key = await recallKey(profile.id);
    /* Cookie alive but key gone (new device, cleared storage): the passphrase is the only way back in. */
    if (!key) { this.profile = profile; return false; }
    this.profile = profile;
    this.masterKey = key;
    this.passkeys = payload.passkeys || [];
    await this.pull();
    return true;
  },

  async signOut() {
    await api('/api/auth/signout', { method: 'POST' }).catch(() => {});
    await forgetKeys();
    this.profile = null; this.masterKey = null; this.pendingRaw = null; this.passkeys = [];
    this.library = emptyLibrary(); this.records = new Map(); this.syncedAt = '';
  },

  async adopt(profile, rawMasterKey) {
    this.profile = profile;
    this.masterKey = await importMasterKey(rawMasterKey);
    await rememberKey(profile.id, this.masterKey);
  },

  /* ---------- encrypted records ---------- */
  async pull() {
    const { records, syncedAt } = await api(`/api/records?since=${encodeURIComponent(this.syncedAt)}`);
    for (const row of records) {
      if (row.deleted) { this.records.delete(row.id); continue; }
      try { this.records.set(row.id, { ...(await decryptRecord(this.masterKey, row)), id: row.id }); }
      catch { /* a record this key cannot open is not ours to read */ }
    }
    this.syncedAt = syncedAt;
    this.materialize();
  },

  async put(records) {
    if (!this.signedIn) throw new Error('Sign in to 4.0-reads first.');
    const list = Array.isArray(records) ? records : [records];
    const payload = await Promise.all(list.map(async (record) => {
      const id = record.id || randomId();
      const stored = { ...record, id };
      this.records.set(id, stored);
      return { id, ...(await encryptRecord(this.masterKey, stored)) };
    }));
    this.materialize();
    await api('/api/records', { method: 'POST', body: { records: payload } });
    return list.length === 1 ? this.records.get(payload[0].id) : payload.map((entry) => this.records.get(entry.id));
  },

  async remove(ids) {
    if (!this.signedIn) throw new Error('Sign in to 4.0-reads first.');
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach((id) => this.records.delete(id));
    this.materialize();
    /* Tombstones carry ciphertext too, so a deletion is not distinguishable from an edit. */
    await api('/api/records', { method: 'POST', body: { records: await Promise.all(list.map(async (id) => ({ id, ...(await encryptRecord(this.masterKey, { id, type: 'tombstone' })), deleted: true }))) } });
  },

  materialize() {
    const library = emptyLibrary();
    for (const record of this.records.values()) {
      if (record.type === 'settings') { library.settings = { ...library.settings, ...record.value }; continue; }
      const bucket = TYPES[record.type];
      if (bucket) library[bucket].push(record);
    }
    for (const key of ['stories', 'creators', 'subscriptions', 'saved']) library[key].sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
    this.library = library;
  },
};
