import { normalizeRecoveryKey, deriveKeys, deriveRecoveryAuth, newSalt, newMasterKey, newRecoveryKey, wrapMasterKey, unwrapMasterKey, wrapWithRecoveryKey, unwrapWithRecoveryKey, importMasterKey, encryptRecord, decryptRecord, randomId, KDF } from './crypto.js';
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
  library: emptyLibrary(),
  records: new Map(),
  syncedAt: '',

  get signedIn() { return Boolean(this.profile && this.masterKey); },

  /* ---------- credentials ---------- */
  async signUp({ name, email, passphrase }) {
    const kdfSalt = newSalt();
    const { authKey, kek } = await deriveKeys(passphrase, kdfSalt);
    const masterKey = newMasterKey();
    const recoveryKey = newRecoveryKey();
    const [wrappedMk, recoveryWrap, recoveryAuthKey] = await Promise.all([
      wrapMasterKey(kek, masterKey),
      wrapWithRecoveryKey(recoveryKey, masterKey),
      deriveRecoveryAuth(recoveryKey, kdfSalt),
    ]);
    const { profile } = await api('/api/auth/signup', { method: 'POST', body: { email, name, authKey, kdfSalt, iterations: KDF.iterations, wrappedMk, recoveryWrap, recoveryAuthKey } });
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
    await this.pull();
  },

  async recover({ email, recoveryKey }) {
    const { salt, iterations } = await api('/api/auth/salt', { method: 'POST', body: { email } });
    const recoveryAuthKey = await deriveRecoveryAuth(recoveryKey, salt, { iterations });
    const { profile, recoveryWrap } = await api('/api/auth/recover', { method: 'POST', body: { email, recoveryAuthKey } });
    const masterKey = await unwrapWithRecoveryKey(recoveryKey, recoveryWrap).catch(() => { throw new Error('That recovery key does not match an account.'); });
    await this.adopt(profile, masterKey);
    await this.pull();
  },

  /** Re-wrap the master key under a new passphrase. Nothing stored needs re-encrypting. */
  async rekey(passphrase) {
    if (!this.signedIn) throw new Error('Sign in first.');
    const kdfSalt = newSalt();
    const { authKey, kek } = await deriveKeys(passphrase, kdfSalt);
    const raw = this.rawMasterKey;
    if (!raw) throw new Error('Re-enter your current passphrase before changing it.');
    const wrappedMk = await wrapMasterKey(kek, raw);
    await api('/api/auth/rekey', { method: 'POST', body: { authKey, kdfSalt, iterations: KDF.iterations, wrappedMk } });
  },

  async restore() {
    const { signedIn, profile } = await api('/api/auth/me');
    if (!signedIn) return false;
    const key = await recallKey(profile.id);
    /* Cookie alive but key gone (new device, cleared storage): the passphrase is the only way back in. */
    if (!key) { this.profile = profile; return false; }
    this.profile = profile;
    this.masterKey = key;
    await this.pull();
    return true;
  },

  async signOut() {
    await api('/api/auth/signout', { method: 'POST' }).catch(() => {});
    await forgetKeys();
    this.profile = null; this.masterKey = null; this.rawMasterKey = null;
    this.library = emptyLibrary(); this.records = new Map(); this.syncedAt = '';
  },

  async adopt(profile, rawMasterKey) {
    this.profile = profile;
    this.rawMasterKey = rawMasterKey;
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
