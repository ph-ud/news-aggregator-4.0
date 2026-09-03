import { normalizeStories, normalizeCreators, staleStoriesForReplace, staleCreatorsForReplace, addedByLabel, summaryParagraphs, summaryLength, SUMMARY_LIMIT } from './src/data.js';
import { html, raw, SafeHtml } from './src/html.js';
import { store } from './src/store.js';
import { createAuthTools } from './src/auth-tools.js';
import { credentialsAvailable, rememberCredential, savedCredential, forgetSilentAccess } from './src/credentials.js';
import { passkeysSupported } from './src/passkeys.js';
import { formatRecoveryKey } from './src/crypto.js';

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');

const state = {
  activeFolder: 'all', view: 'library', selectedStoryId: null, newStoryIds: [],
  authMode: 'signin', authError: '', authBusy: false, authDraft: { name: '', email: '' },
  recoveryKey: '', booting: true, webmcp: { supported: false, registered: 0 },
};
/* Names already handed to document.modelContext.registerTool(). Tracking this instead of a
   single "done" flag means a partial failure (one bad tool mid-loop) can't wedge every later
   sign-in into retrying — and re-registering — tools the browser already has. */
const registeredToolNames = new Set();
let rekeyInFlight = false;
/* Whether this browser has a password store to offer. Fixed for the life of the page. */
const hasPasswordManager = credentialsAvailable();
/* Passkeys are the one credential an agent driving this browser cannot use: unlocking
   needs a fingerprint, a face, or a device PIN. */
const hasPasskeys = passkeysSupported();

const library = () => store.library;
const settings = () => store.library.settings;

/* ---------- helpers ---------- */
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
function hostOf(value) { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; } }
function date(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Recently' : new Intl.DateTimeFormat('en-US', options).format(parsed); }
function today() { return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()); }
function slugFor(value) { return String(value).trim().toLocaleLowerCase().replace(/\s+/g, ' ').slice(0, 60); }
function titleFor(value) { return String(value).trim().replace(/\s+/g, ' ').slice(0, 60); }
function initials(value = '?') { return String(value).trim().charAt(0).toUpperCase() || '?'; }
function icon(name) { const icons = {
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h11.5v16H7a2.5 2.5 0 0 0-2.5 2.5V5.5Z"/><path d="M7 3v16"/><path d="M10 7h5M10 11h5"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5h16v14H4z"/><path d="M4 14h4l1.5 2h5L16 14h4"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3.5 6.5h6l1.7 2H20a1 1 0 0 1 1 1V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5a1 1 0 0 1 .5-1Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 5v14M5 12h14"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 15.2A8.4 8.4 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.6L6 21V4.5Z"/></svg>',
  bookmarkFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.7"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.6L6 21V4.5Z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 2.8 1.7 7.5 7.5 1.7-7.5 1.7-1.7 7.5-1.7-7.5-7.5-1.7 7.5-1.7L12 2.8Z"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z"/><path d="M10.2 18a2 2 0 0 0 3.6 0"/></svg>',
  bellFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4"><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z"/><path d="M10.2 18a2 2 0 0 0 3.6 0" fill="none"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8 6 12l4 4M6 12h9"/></svg>',
}; return raw(icons[name] || ''); }
function toast(message) { const element = document.createElement('div'); element.className = 'toast'; element.textContent = message; toastRegion.append(element); setTimeout(() => element.remove(), 2800); }

/* ---------- session ---------- */
function requireAccount() {
  if (!store.signedIn) throw new Error('Sign in to 4.0-reads first. Saving stories and subscribing both need an account.');
  /* The recovery key is shown exactly once. Anything that repaints while it is up destroys
     the only fallback for a forgotten passphrase, so nothing may write until it is dismissed. */
  if (state.view === 'recovery-key' && state.recoveryKey) throw new Error('The reader is still saving the recovery key from their new account. Wait until they have confirmed it.');
  return store.profile;
}

async function signUp({ name, email, passphrase }) {
  const { recoveryKey } = await store.signUp({ name, email, passphrase });
  await rememberCredential({ email, name, passphrase });
  state.authDraft = { name: '', email: '' };
  state.recoveryKey = recoveryKey;
  state.view = 'recovery-key';
  registerWebMcpTools();
}
async function signIn({ email, passphrase }) {
  await store.signIn({ email, passphrase });
  /* Offered after the passphrase is known to work, so the manager never learns a wrong one. */
  await rememberCredential({ email, name: store.profile.name, passphrase });
  state.authDraft = { name: '', email: '' };
  state.view = 'library';
  registerWebMcpTools();
  toast(`Welcome back, ${store.profile.name}.`);
}
async function recoverAccount({ email, recoveryKey }) {
  await store.recover({ email, recoveryKey });
  state.authDraft = { name: '', email: '' };
  state.view = 'library';
  registerWebMcpTools();
  toast('Recovered. Set a new passphrase from your account menu.');
}
/**
 * Sign in with a credential from the browser's password manager. The chooser is browser UI
 * the page cannot script, and this runs only from the reader's own click: an agent that can
 * click buttons must not be able to unlock the library out of the password store.
 */
async function signInWithSavedCredential() {
  const credential = await savedCredential();
  if (!credential) return false;
  state.authBusy = true; state.authError = ''; render();
  try { await signIn(credential); return true; }
  catch (error) { state.authError = `${error.message} The saved passphrase may be out of date — type it to sign in, and the browser will offer to update it.`; return false; }
  finally { state.authBusy = false; render(); }
}

/**
 * Unlock with a passkey. Like the saved-credential path this runs only from the reader's own
 * click, and the authenticator will not produce the secret without verifying a person.
 */
async function unlockWithPasskeyFromForm() {
  state.authBusy = true; state.authError = ''; render();
  try { await store.signInWithPasskey(); state.view = 'library'; registerWebMcpTools(); toast(`Welcome back, ${store.profile.name}.`); }
  catch (error) { if (error.name !== 'NotAllowedError') state.authError = error.message; }
  finally { state.authBusy = false; render(); }
}

async function signOut() { await store.signOut(); await forgetSilentAccess(); state.view = 'library'; state.authMode = 'signin'; state.selectedStoryId = null; state.recoveryKey = ''; render(); }

/* ---------- library data ---------- */
async function ensureFolder(name) {
  const title = titleFor(name); const slug = slugFor(title);
  if (!title || !slug) return null;
  return library().folders.find((folder) => folder.slug === slug)
    || store.put({ type: 'folder', name: title, slug, addedAt: new Date().toISOString() });
}
function storiesForFolder() {
  const { stories } = library();
  if (state.activeFolder === 'all') return stories;
  if (state.activeFolder === 'saved') { const saved = new Set(library().saved.map((entry) => entry.storyId)); return stories.filter((story) => saved.has(story.id)); }
  return stories.filter((story) => (story.tagIds || []).includes(state.activeFolder));
}
function folderCount(id) { return library().stories.filter((story) => (story.tagIds || []).includes(id)).length; }
function savedFor(storyId) { return library().saved.find((entry) => entry.storyId === storyId); }
function isSaved(storyId) { return Boolean(savedFor(storyId)); }
function subscriptionFor(url) { const host = hostOf(url); return library().subscriptions.find((entry) => entry.host === host); }
function isSubscribed(url) { return Boolean(subscriptionFor(url)); }

async function toggleSave(storyId) {
  requireAccount();
  const story = library().stories.find((entry) => entry.id === storyId);
  if (!story) throw new Error('That story is not on your shelf.');
  const existing = savedFor(storyId);
  if (existing) { await store.remove(existing.id); return { saved: false, story }; }
  await store.put({ type: 'saved', storyId, title: story.title, url: story.url, source: story.source, addedAt: new Date().toISOString() });
  return { saved: true, story };
}

async function toggleSubscription({ name, url, kind = 'blog', description = '' }) {
  requireAccount();
  const host = hostOf(url);
  if (!host) throw new Error('A subscription needs a valid https source URL.');
  const existing = subscriptionFor(url);
  if (existing) { await store.remove(existing.id); return { subscribed: false, subscription: existing }; }
  const subscription = await store.put({ type: 'subscription', host, name: titleFor(name) || host, url: safeUrl(url), kind, description, addedAt: new Date().toISOString() });
  return { subscribed: true, subscription };
}

async function injectNews(topic, stories, mode = 'replace') {
  requireAccount();
  const normalized = normalizeStories(topic, stories);
  if (!normalized.length) throw new Error('No valid stories were supplied. Each story needs a title, source, and https URL.');
  const enriched = [];
  for (const story of normalized) {
    const names = story.tags?.length ? story.tags : [story.category || topic];
    const folders = [];
    for (const name of names) { const folder = await ensureFolder(name); if (folder) folders.push(folder); }
    enriched.push({ ...story, tagIds: folders.map((folder) => folder.id), tagNames: folders.map((folder) => folder.name), folderName: folders[0]?.name });
  }
  if (mode === 'replace') {
    const incoming = new Set(enriched.map((story) => story.url));
    const stale = staleStoriesForReplace(library().stories, enriched[0].topic, incoming);
    if (stale.length) {
      const staleIds = stale.map((story) => story.id);
      await store.remove(staleIds);
      /* A removed story leaves its "saved" record pointing nowhere; drop that too, or the
         reader's saved count and shelf quietly disagree. */
      const orphanedSaved = library().saved.filter((entry) => staleIds.includes(entry.storyId));
      if (orphanedSaved.length) await store.remove(orphanedSaved.map((entry) => entry.id));
    }
  }
  await store.put(enriched);
  state.activeFolder = enriched[0]?.tagIds[0] || 'all';
  state.newStoryIds = enriched.map((story) => story.id);
  state.view = 'library'; render();
  setTimeout(() => { state.newStoryIds = []; render(); }, 900);
  toast(`${enriched.length} ${enriched.length === 1 ? 'story' : 'stories'} added to your shelf.`);
  return { topic, tags: [...new Set(enriched.flatMap((story) => story.tagNames))], mode, added: enriched.length, feedCount: library().stories.length, note: 'Stories are on the shelf but not saved yet — the reader saves each one with the Save button.' };
}

async function addCreators(topic, creators, mode = 'append') {
  requireAccount();
  const normalized = normalizeCreators(topic, creators);
  if (!normalized.length) throw new Error('No valid creators were supplied. Each one needs a name and an https URL.');
  const known = new Set(library().creators.map((creator) => creator.host));
  const incoming = normalized.filter((creator) => mode === 'replace' || !known.has(creator.host));
  if (mode === 'replace') {
    const stale = staleCreatorsForReplace(library().creators, topic);
    if (stale.length) await store.remove(stale.map((creator) => creator.id));
  }
  if (incoming.length) await store.put(incoming);
  state.view = 'discover'; render();
  toast(`${incoming.length} ${incoming.length === 1 ? 'creator' : 'creators'} to explore.`);
  return { topic, mode, added: incoming.length, creatorCount: library().creators.length, note: 'Nothing is subscribed automatically — the reader subscribes with the Subscribe button.' };
}

async function updateSettings(patch) {
  await store.put({ id: 'settings', type: 'settings', value: { ...settings(), ...patch } });
  /* The click handler renders synchronously, before this write resolves, so the reader
     controls need their own repaint or the change never reaches the DOM. */
  render();
}

/* ---------- views ---------- */
function authView() {
  const mode = state.authMode;
  const isSignUp = mode === 'signup';
  const isRecover = mode === 'recover';
  const submitLabel = isSignUp ? 'Create account' : isRecover ? 'Recover account' : 'Sign in';
  return html`<div class="auth-page"><section class="auth-hero"><a class="brand" href="#" data-action="noop"><span>4.0</span><strong>reads</strong></a><p class="eyebrow">News, blogs, and the people behind them</p><h1>Your shelf<br><em>needs a name.</em></h1><p class="auth-lead">An account keeps your saved stories, your shelves, and everyone you subscribe to in one place — encrypted so that only you can read them.</p><ul class="auth-points"><li>${icon('bookmark')}<span><strong>Save</strong> any story to come back to it.</span></li><li>${icon('bell')}<span><strong>Subscribe</strong> to blogs, newsletters, and independent creators.</span></li><li>${icon('lock')}<span><strong>End-to-end encrypted.</strong> The server stores ciphertext it cannot open.</span></li></ul></section>
  <section class="auth-panel"><div class="auth-tabs"><button class="${!isSignUp && !isRecover ? 'active' : ''}" data-action="auth-mode" data-mode="signin">Sign in</button><button class="${isSignUp ? 'active' : ''}" data-action="auth-mode" data-mode="signup">Create account</button></div>
  <form class="auth-form" data-form="auth" novalidate>${isSignUp ? html`<label>Name<input name="name" type="text" autocomplete="name" value="${state.authDraft.name}" placeholder="What should we call you?" /></label>` : ''}
  <label>Email<input name="email" type="email" autocomplete="username" required value="${state.authDraft.email}" placeholder="you@example.com" /></label>
  ${isRecover
    ? html`<label>Recovery key<input name="recoveryKey" type="text" required autocomplete="off" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-…" /></label>`
    : html`<label>Passphrase<input name="passphrase" type="password" autocomplete="${isSignUp ? 'new-password' : 'current-password'}" required placeholder="At least 8 characters with a number" /></label>`}
  ${state.authError ? html`<p class="auth-error" role="alert">${state.authError}</p>` : ''}
  <button class="primary-button auth-submit" type="submit" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Deriving your key…' : submitLabel} ${icon('arrow')}</button></form>
  ${hasPasskeys && !isSignUp && !isRecover && html`<button class="pill-button pill-wide passkey-button" type="button" data-action="unlock-passkey">${icon('lock')}<span>Unlock with a passkey</span></button>`}
  ${hasPasswordManager && !isSignUp && !isRecover && html`<p class="auth-note"><button class="link-button" type="button" data-action="use-saved-credential">Use a passphrase saved in this browser</button></p>`}
  ${isRecover
    ? html`<p class="auth-note"><button class="link-button" data-action="auth-mode" data-mode="signin">Back to sign in</button></p>`
    : html`<p class="auth-note"><button class="link-button" data-action="auth-mode" data-mode="recover">Lost your passphrase? Use your recovery key.</button></p>`}
  <p class="auth-note">Your passphrase never leaves this browser. It derives two separate keys: one the server checks, and one that decrypts your library and that the server never sees. That also means nobody — us included — can recover your shelf without your passphrase or your recovery key.</p></section></div>`;
}

/** Shown once, immediately after sign-up. Losing this and the passphrase means losing the library. */
function recoveryKeyView() {
  return html`<div class="auth-page recovery-page"><section class="auth-hero"><a class="brand" href="#" data-action="noop"><span>4.0</span><strong>reads</strong></a><p class="eyebrow">Save this now</p><h1>Your recovery<br><em>key.</em></h1><p class="auth-lead">This is the only other way into your library. Because your stories are encrypted with a key we never receive, a forgotten passphrase cannot be reset — this key is the sole fallback. Write it down and keep it somewhere safe.</p></section>
  <section class="auth-panel"><p class="side-label">Recovery key</p><code class="recovery-key">${formatRecoveryKey(state.recoveryKey)}</code>
  <div class="recovery-actions"><button class="pill-button" data-action="copy-recovery">${icon('bookmark')}<span>Copy</span></button></div>
  <label class="recovery-confirm"><input type="checkbox" data-action="confirm-recovery" /> <span>I have saved this key somewhere safe.</span></label>
  <button class="primary-button auth-submit" data-action="finish-recovery" disabled>Continue to my shelf ${icon('arrow')}</button>
  <p class="auth-note">We cannot show this again, and we cannot email it to you: it is not stored anywhere in a form we can read.</p></section></div>`;
}

function passphraseForm({ needsCurrent = true } = {}) {
  return html`<form class="auth-form passphrase-form" data-form="passphrase" novalidate>
  ${needsCurrent ? html`<label>Current passphrase<input name="current" type="password" autocomplete="current-password" required placeholder="The one you use today" /></label>` : ''}
  <label>New passphrase<input name="next" type="password" autocomplete="new-password" required placeholder="At least 8 characters with a number" /></label>
  <label>Confirm new passphrase<input name="confirm" type="password" autocomplete="new-password" required placeholder="Type it again" /></label>
  <p class="auth-error" role="alert" data-role="passphrase-error" hidden></p>
  <button class="primary-button auth-submit" type="submit"><span data-role="label">Change passphrase</span> ${icon('arrow')}</button></form>`;
}

/** Forced immediately after recovery: the old passphrase is forgotten, so one must be set. */
function setPassphraseView() {
  return html`<div class="auth-page"><section class="auth-hero"><a class="brand" href="#" data-action="noop"><span>4.0</span><strong>reads</strong></a><p class="eyebrow">Almost there</p><h1>Choose a new<br><em>passphrase.</em></h1><p class="auth-lead">Your library is unlocked, but only for as long as this page stays open — the passphrase you forgot still cannot open it. Set a new one now and your shelf is reachable again from any device.</p><p class="auth-lead">Your recovery key does not change and stays valid.</p></section>
  <section class="auth-panel"><p class="side-label">New passphrase</p>${passphraseForm({ needsCurrent: false })}<p class="auth-note">This re-wraps the key your library is already encrypted with. Nothing is re-encrypted, and nothing is re-uploaded.</p></section></div>`;
}

function accountView() {
  return html`<div class="shell">${sidebar()}<main class="library-main"><header class="topbar"><span>${today()}</span><span class="page-count">Account</span></header>
  <section class="library-hero"><p class="eyebrow">Account</p><h1>Your keys,<br><em>your shelf.</em></h1><p>${store.profile.name} · ${store.profile.email}</p></section>
  <section class="account-grid"><div class="account-block"><p class="eyebrow">Change passphrase</p><h2>Set a new passphrase</h2><p class="account-copy">Your passphrase never reaches the server. Changing it re-wraps the key your library is already encrypted with, so nothing has to be re-encrypted or re-uploaded — and your recovery key keeps working.</p>${passphraseForm()}</div>
  ${hasPasskeys && html`<div class="account-block"><p class="eyebrow">Passkeys</p><h2>Unlock with your device</h2><p class="account-copy">A passkey adds a second way into the same library, held by this device and opened with your fingerprint, face, or device PIN. It re-encrypts nothing and replaces neither your passphrase nor your recovery key — and because the secret lives in the authenticator, an assistant driving this browser cannot use it.</p>
  ${store.passkeys.length ? html`<ul class="account-list passkey-list">${store.passkeys.map((passkey) => html`<li>${icon('check')}<span>Added ${date(passkey.addedAt)}</span><button class="link-button" data-action="remove-passkey" data-passkey="${passkey.id}">Remove</button></li>`)}</ul>` : html`<p class="account-copy">No passkey on this account yet.</p>`}
  <form class="auth-form passkey-form" data-form="passkey" novalidate><label>Current passphrase<input name="current" type="password" autocomplete="current-password" required placeholder="Confirms it is you" /></label>
  <p class="auth-error" role="alert" data-role="passkey-error" hidden></p>
  <button class="primary-button auth-submit" type="submit"><span data-role="label">Add a passkey</span> ${icon('arrow')}</button></form>
  <p class="auth-note">Your passphrase is needed once here: it is the only thing that can produce the key a passkey then wraps.</p></div>`}
  <div class="account-block account-facts"><p class="eyebrow">What this does</p><ul class="account-list"><li>${icon('lock')}<span>Derives a new key from the new passphrase and re-wraps the same master key.</span></li><li>${icon('bell')}<span>Signs you out everywhere else. Other devices need the new passphrase to return.</span></li><li>${icon('bookmark')}<span>Leaves your ${library().stories.length} ${library().stories.length === 1 ? 'story' : 'stories'} and ${library().subscriptions.length} ${library().subscriptions.length === 1 ? 'subscription' : 'subscriptions'} untouched.</span></li></ul><p class="account-copy">If you forget the new passphrase, your recovery key is still the only way back. We cannot reset it for you.</p></div></section></main>
  <aside class="library-aside"><div class="aside-block aside-note"><span>${icon('lock')}</span><p>The server stores your library as ciphertext it cannot open, and only ever sees a value derived from your passphrase — never the passphrase itself.</p></div></aside></div>`;
}

function accountChip() { const name = store.profile?.name || 'Reader'; return html`<div class="account-chip"><span class="reader-mark">${initials(name)}</span><button class="account-identity" data-action="open-account" aria-label="Account settings"><strong>${name}</strong><small>${store.profile?.email || ''}</small></button><button data-action="sign-out" aria-label="Sign out">${icon('logout')}</button></div>`; }
function folderRow(folder) { return html`<div class="folder-wrap"><button class="folder ${state.activeFolder === folder.id && state.view === 'library' ? 'active' : ''}" data-action="open-folder" data-folder="${folder.id}">${icon('folder')}<span>${folder.name}</span><b>${folderCount(folder.id)}</b></button><button class="folder-menu" data-action="rename-folder" data-folder="${folder.id}" aria-label="Rename ${folder.name}">${icon('dots')}</button></div>`; }
function sidebar() { const { stories: feed, saved, folders, subscriptions } = library(); const libraryActive = state.view === 'library'; return html`<aside class="sidebar"><a class="brand" href="#" data-action="open-all"><span>4.0</span><strong>reads</strong></a>
  <nav class="primary-nav" aria-label="Sections"><button class="nav-link ${libraryActive ? 'active' : ''}" data-action="open-all">${icon('book')}<span>Library</span></button><button class="nav-link ${state.view === 'discover' ? 'active' : ''}" data-action="open-discover">${icon('compass')}<span>Discover</span><b>${library().creators.length || ''}</b></button></nav>
  <div class="library-title"><span>Library</span><button data-action="new-folder" aria-label="Create shelf">${icon('plus')}</button></div>
  <nav class="library" aria-label="Reading shelves"><button class="folder ${libraryActive && state.activeFolder === 'all' ? 'active' : ''}" data-action="open-all">${icon('inbox')}<span>All stories</span><b>${feed.length}</b></button><button class="folder ${libraryActive && state.activeFolder === 'saved' ? 'active' : ''}" data-action="open-saved">${icon('bookmark')}<span>Saved</span><b>${saved.length}</b></button>${folders.map(folderRow)}</nav>
  <div class="library-title"><span>Subscriptions</span><b class="count-pill">${subscriptions.length}</b></div>
  <nav class="library" aria-label="Subscriptions">${subscriptions.length ? subscriptions.slice(0, 6).map((entry) => html`<a class="folder sub-row" href="${safeUrl(entry.url)}" target="_blank" rel="noreferrer">${icon('bellFill')}<span>${entry.name}</span></a>`) : html`<p class="sidebar-empty">Subscribe from any story or creator card.</p>`}</nav>
  <div class="sidebar-spacer"></div>${accountChip()}</aside>`; }

/* Records are researched by an assistant and handed to us; nothing here was fetched from a feed.
   Every surface that shows that text shows this, so agent-written prose is never mistaken for the
   publisher's own. */
function provenanceTag(record) { return html`<span class="agent-tag">${icon('sparkle')}Added by ${addedByLabel(record)}</span>`; }
function faviconFor(story) { const host = hostOf(story.url); return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=96` : ''; }
function storyImage(story) { return story.imageUrl ? safeUrl(story.imageUrl) : faviconFor(story); }
function storyMeta(story) { return html`<div class="story-meta"><span>${story.source}</span><i></i><span>${date(story.publishedAt)}</span>${provenanceTag(story)}</div>`; }
function cover(story, large = false) { const image = storyImage(story); const mark = initials(story.source); return html`<div class="cover ${large ? 'cover-large' : ''} ${story.imageUrl ? '' : 'cover-logo'}"><span>${mark}</span>${image ? html`<img src="${image}" alt="" loading="lazy" data-fallback="remove" />` : ''}</div>`; }
function saveButton(story, wide = false) { const saved = isSaved(story.id); return html`<button class="pill-button ${saved ? 'is-on' : ''} ${wide ? 'pill-wide' : ''}" data-action="toggle-save" data-story="${story.id}" aria-pressed="${String(saved)}">${icon(saved ? 'bookmarkFill' : 'bookmark')}<span>${saved ? 'Saved' : 'Save'}</span></button>`; }
function subscribeButton(source, wide = false) { const on = isSubscribed(source.url); return html`<button class="pill-button ${on ? 'is-on' : ''} ${wide ? 'pill-wide' : ''}" data-action="toggle-subscribe" data-url="${source.url}" data-name="${source.name}" data-kind="${source.kind || 'blog'}" aria-pressed="${String(on)}">${icon(on ? 'check' : 'bell')}<span>${on ? 'Subscribed' : 'Subscribe'}</span></button>`; }
function storyActions(story, wide = false) { return html`<div class="card-actions">${saveButton(story, wide)}${subscribeButton({ url: story.url, name: story.source, kind: 'blog' }, wide)}</div>`; }

function emptyFeed() { return html`<section class="empty-feed"><div class="empty-book">${icon('book')}</div><p class="eyebrow">A blank first page</p><h2>Save something worth staying with.</h2><p>Ask your assistant for news on a topic, or head to Discover to find blogs and independent creators worth following.</p><span class="empty-hint">Sources, dates, and context stay attached.</span></section>`; }
function storyCard(story, index) { const isNew = state.newStoryIds.includes(story.id); return html`<article class="story-card ${isNew ? 'story-arriving' : ''}" style="--arrival-index:${index}"><button class="cover-button" data-action="open-reader" data-story="${story.id}" aria-label="Open ${story.title}">${cover(story)}</button><div class="story-card-copy"><p class="story-kicker">${story.folderName || story.category || 'Reading'}</p><h3>${story.title}</h3><p class="summary">${story.summary}</p>${storyActions(story)}<footer>${storyMeta(story)}<button class="read-link" data-action="open-reader" data-story="${story.id}">Read ${icon('arrow')}</button></footer></div></article>`; }
function continueCard(story) { return html`<section class="continue-card"><div class="continue-cover">${cover(story, true)}</div><div class="continue-copy"><p class="eyebrow">Continue reading</p><h2>${story.title}</h2><p class="continue-source">${story.source} <span>·</span> ${date(story.publishedAt)}</p>${provenanceTag(story)}<p class="summary">${story.summary}</p><div class="continue-actions"><button class="primary-button" data-action="open-reader" data-story="${story.id}">Open story ${icon('arrow')}</button>${storyActions(story)}</div></div></section>`; }

function libraryView() {
  const stories = storiesForFolder();
  const currentFolder = library().folders.find((folder) => folder.id === state.activeFolder);
  const heading = state.activeFolder === 'saved' ? 'Saved' : currentFolder ? currentFolder.name : 'All stories';
  const lead = stories[0]; const rest = stories.slice(1);
  return html`<div class="shell">${sidebar()}<main class="library-main"><header class="topbar"><span>${today()}</span><span class="page-count">${stories.length} ${stories.length === 1 ? 'story' : 'stories'}</span></header>
  <section class="library-hero"><p class="eyebrow">${store.profile.name}'s reading shelf</p><h1>Make room for<br><em>good stories.</em></h1><p>Reporting, blogs, and independent voices — saved with their source and ready when you are.</p></section>
  ${lead ? continueCard(lead) : emptyFeed()}
  <section class="shelf-heading"><div><p class="eyebrow">${heading}</p><h2>On your shelf</h2></div><span>${stories.length ? 'Newest first' : 'Nothing here yet'}</span></section>
  ${rest.length ? html`<section class="story-grid">${rest.map(storyCard)}</section>` : ''}</main>
  <aside class="library-aside"><div class="aside-block"><p class="eyebrow">Reading rhythm</p><div class="rhythm-number">${library().saved.length}</div><p>stories saved<br>from ${library().stories.length} on your shelf</p></div><div class="aside-block"><p class="eyebrow">Following</p><div class="rhythm-number">${library().subscriptions.length}</div><p>${library().subscriptions.length === 1 ? 'blog or creator' : 'blogs and creators'}<br>you subscribe to</p></div><div class="aside-block aside-note"><span>${icon('bookmark')}</span><p>Every story keeps its original source, publication date, and a direct path back to the reporting.</p></div><div class="aside-footer">${state.webmcp.supported ? `WebMCP ready · ${state.webmcp.registered} tools` : 'Library ready'}</div></aside></div>`;
}

function creatorCard(creator, index) { return html`<article class="creator-card" style="--arrival-index:${index}"><div class="creator-head"><div class="creator-mark">${initials(creator.name)}</div><div><h3>${creator.name}</h3><p class="creator-host"><em>${creator.kind}</em> <span>·</span> ${hostOf(creator.url) || 'source'}${creator.cadence ? html` <span>·</span> ${creator.cadence}` : ''}</p>${provenanceTag(creator)}</div></div><p class="summary">${creator.description}</p>${creator.whyRelevant ? html`<p class="creator-why">${icon('sparkle')}<span>${creator.whyRelevant}</span></p>` : ''}<div class="creator-topics">${creator.topics.map((topic) => html`<span>${topic}</span>`)}</div><div class="card-actions">${subscribeButton(creator)}<a class="read-link" href="${safeUrl(creator.url)}" target="_blank" rel="noreferrer">Visit ${icon('arrow')}</a></div></article>`; }
function discoverView() {
  const { creators, subscriptions } = library();
  return html`<div class="shell">${sidebar()}<main class="library-main"><header class="topbar"><span>${today()}</span><span class="page-count">${creators.length} ${creators.length === 1 ? 'creator' : 'creators'}</span></header>
  <section class="library-hero"><p class="eyebrow">Discover</p><h1>Find the people<br><em>worth following.</em></h1><p>Ask your assistant to research blogs, newsletters, and independent creators on a topic. They arrive here with their sources — you decide who to subscribe to.</p></section>
  ${creators.length ? html`<section class="shelf-heading"><div><p class="eyebrow">Researched for you</p><h2>Blogs &amp; creators</h2></div><span>${subscriptions.length} subscribed</span></section><section class="creator-grid">${creators.map(creatorCard)}</section>` : html`<section class="empty-feed"><div class="empty-book">${icon('compass')}</div><p class="eyebrow">Nothing discovered yet</p><h2>Who should you be reading?</h2><p>Try asking: <em>“find me three independent blogs about urban design”</em>. Results land here through the <code>discover-creators</code> WebMCP tool.</p><span class="empty-hint">The app never fetches or opens the links it is given.</span></section>`}
  ${subscriptions.length ? html`<section class="shelf-heading"><div><p class="eyebrow">Your subscriptions</p><h2>Following</h2></div><span>Kept with your account</span></section><section class="sub-grid">${subscriptions.map((entry) => html`<div class="sub-card"><div class="creator-mark">${initials(entry.name)}</div><div class="sub-copy"><strong>${entry.name}</strong><small>${entry.host} · since ${date(entry.subscribedAt)}</small></div>${subscribeButton(entry)}</div>`)}</section>` : ''}</main>
  <aside class="library-aside"><div class="aside-block"><p class="eyebrow">Following</p><div class="rhythm-number">${subscriptions.length}</div><p>subscriptions saved<br>to ${store.profile.name}'s account</p></div><div class="aside-block aside-note"><span>${icon('sparkle')}</span><p>Discovery is research, not endorsement. Each card keeps the creator's own site so you can judge for yourself.</p></div><div class="aside-footer">${state.webmcp.supported ? `WebMCP ready · ${state.webmcp.registered} tools` : 'Discovery ready'}</div></aside></div>`;
}

function readerView(story) {
  const paragraphs = summaryParagraphs(story);
  const origin = hostOf(story.url) || story.source;
  const { theme, fontScale } = settings();
  return html`<div class="reader-page reader-theme-${theme}" style="--reader-scale:${fontScale}"><header class="reader-topbar"><button class="back-button" aria-label="Back to shelf" data-action="back-to-library">${icon('back')}<span>Back to shelf</span></button><div class="reader-title">${story.folderName || story.category || 'Saved story'}</div><div class="reader-tools"><button data-action="decrease-font" aria-label="Decrease text size">A−</button><button data-action="increase-font" aria-label="Increase text size">A+</button><button data-action="toggle-theme" aria-label="Toggle reading theme">${theme === 'night' ? icon('sun') : icon('moon')}</button><a href="${safeUrl(story.url)}" target="_blank" rel="noreferrer" class="source-link">Source ${icon('arrow')}</a></div></header>
  <div class="reading-progress"><span style="width:32%"></span></div>
  <div class="reader-layout"><aside class="reader-rail"><p class="eyebrow">On this page</p><ol><li class="active">Summary</li><li>Source notes</li></ol><div class="rail-rule"></div><span class="rail-meta">${date(story.publishedAt, { month: 'long', day: 'numeric', year: 'numeric' })}</span><span class="rail-meta">Summary · ${summaryLength(story)}</span></aside>
  <article class="article"><p class="eyebrow">${story.source} <span class="eyebrow-dot">·</span> ${date(story.publishedAt)}</p><h1>${story.title}</h1><p class="article-dek">What ${addedByLabel(story)} wrote about this story when it was added to the shelf (${date(story.addedAt, { month: 'long', day: 'numeric', year: 'numeric' })}). The reporting itself stays at ${story.source}.</p><div class="article-rule"></div>
  <p class="article-notice">${icon('sparkle')}<span>You are reading a summary written by ${addedByLabel(story)}, not ${story.source}'s article. 4.0-reads never fetches or stores article text — <a href="${safeUrl(story.url)}" target="_blank" rel="noreferrer">read the original at ${origin}</a>.</span></p>
  <div class="article-body"><p class="dropcap">${paragraphs[0]}</p>${paragraphs.slice(1).map((paragraph) => html`<p>${paragraph}</p>`)}<h2>Source notes</h2><p>4.0-reads keeps this story's link, source name, and publication date — never the article body, which it has no way to retrieve. Read the full reporting at <a href="${safeUrl(story.url)}" target="_blank" rel="noreferrer">${story.source}</a>.</p></div><footer class="article-footer"><button data-action="back-to-library">${icon('back')} Back to shelf</button><a href="${safeUrl(story.url)}" target="_blank" rel="noreferrer">Read original ${icon('arrow')}</a></footer></article>
  <aside class="reader-side"><div class="reader-cover">${cover(story, true)}</div><p class="side-label">Saved in</p><strong>${story.folderName || story.category || 'All stories'}</strong><div class="side-rule"></div><div class="side-actions">${saveButton(story, true)}${subscribeButton({ url: story.url, name: story.source }, true)}</div><p class="side-caption">Saving keeps it on ${store.profile.name}'s shelf. Subscribing follows everything from ${hostOf(story.url) || story.source}.</p></aside></div></div>`;
}

/**
 * Trusted Types turns every innerHTML assignment into a TypeError unless the value came
 * from a registered policy. This policy is not a rubber stamp: it verifies that the string
 * was produced by the html template, which escapes every interpolation by construction.
 * Markup assembled any other way — including anything an injected script could build —
 * cannot reach the DOM. The CSP allows this policy name and no other, so a second, laxer
 * policy cannot be registered.
 */
const viewPolicy = window.trustedTypes?.createPolicy
  ? window.trustedTypes.createPolicy('reads-views', {
      createHTML: (value, source) => {
        if (!(source instanceof SafeHtml) || source.value !== value) throw new TypeError('Refusing markup that did not come from the html template.');
        return value;
      },
    })
  : null;

/** The only place in the application that writes markup into the document. */
function paint(view) {
  if (!(view instanceof SafeHtml)) throw new TypeError('Views must be built with the html template.');
  app.innerHTML = viewPolicy ? viewPolicy.createHTML(view.value, view) : view.value;
}

function render() {
  if (state.booting) { paint(html`<div class="auth-page boot-page"><p class="eyebrow">Unlocking your library…</p></div>`); return; }
  if (state.view === 'recovery-key' && state.recoveryKey) { paint(recoveryKeyView()); return; }
  /* Recovered but no passphrase yet: nothing else is reachable until one is chosen. */
  if (store.needsNewPassphrase) { paint(setPassphraseView()); return; }
  if (!store.signedIn) {
    paint(authView());
    const field = app.querySelector('input[name="name"], input[name="email"]');
    if (field && document.activeElement?.tagName !== 'INPUT') field.focus();
    return;
  }
  const story = library().stories.find((entry) => entry.id === state.selectedStoryId);
  if (state.view === 'reader' && story) paint(readerView(story));
  else if (state.view === 'discover') paint(discoverView());
  else if (state.view === 'account') paint(accountView());
  else { state.view = 'library'; paint(libraryView()); }
}

function reportError(error) { toast(error.message); render(); }

/* ---------- WebMCP ---------- */
const UNTRUSTED = { untrustedContentHint: true };
function accountSnapshot() {
  return store.signedIn
    ? { signedIn: true, needsNewPassphrase: store.needsNewPassphrase, account: { name: store.profile.name, email: store.profile.email }, storyCount: library().stories.length, savedCount: library().saved.length, subscriptionCount: library().subscriptions.length, creatorCount: library().creators.length }
    : { signedIn: false, needsNewPassphrase: false, account: null, storyCount: 0, savedCount: 0, subscriptionCount: 0, creatorCount: 0 };
}

async function registerWebMcpTools() {
  if (!document.modelContext?.registerTool) return;
  /* Login is a handoff, never a delegation: these tools open the form and wait for the
     reader. Their arguments carry no passphrase, and they never should. */
  const authTools = createAuthTools({ store, state, render, snapshot: accountSnapshot, signOut, rekeyInFlight: () => rekeyInFlight });
  const tools = [
    { name: 'get-account-status', title: 'Check the 4.0-reads account', description: 'Report whether a reader is signed in to 4.0-reads and how much is in their library. Call this before saving, subscribing, or adding anything: every write tool fails while signed out. Only the person at the keyboard can sign in, because their passphrase is what decrypts the library — call start-sign-in to put the form in front of them rather than asking them for credentials.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async () => accountSnapshot() },

    { name: 'inject-news-to-feed', title: 'Add web-researched news to 4.0-reads', description: 'Create or update a personal topic shelf with selected web-researched articles. Requires a signed-in account. Search fast and favor trustworthy primary reporting published in the last 24–48 hours; a story older than 7 days should only appear when it is essential context, and month-old stories are normally out of scope. Prefer direct source pages, verify publication time, avoid duplicates, and keep the result set concise. Write a real summary for every story: this app never fetches the article, so your summary is the entire text the reader gets unless they follow the link, and a single teaser line leaves them with nothing to read. Aim for 4–6 sentences (roughly 80–150 words) covering what happened, who is involved, the specific figures or findings that matter, and why it is significant — in your own words, drawn only from the reporting, never invented and never a verbatim copy of the article. Provide imageUrl when a relevant article image is available; otherwise the shelf uses the source site favicon. Stories arrive unsaved — the reader chooses what to save. mode: "replace" (the default) only replaces this exact topic\'s own shelf, never other topics\' stories. The app never fetches or opens article links.', inputSchema: { type: 'object', properties: { topic: { type: 'string', maxLength: 120 }, mode: { type: 'string', enum: ['replace', 'append'] }, stories: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', properties: {
      title: { type: 'string', description: 'The article\'s own headline, not a rewritten one.' },
      source: { type: 'string', description: 'Publication name, e.g. "Reuters" — not a URL.' },
      url: { type: 'string', description: 'Direct https link to the article on the publisher\'s site.' },
      imageUrl: { type: 'string', description: 'Direct https link to a relevant article image, if there is one.' },
      publishedAt: { type: 'string', description: 'Original publication time as an ISO 8601 date, verified from the article rather than the search index.' },
      summary: { type: 'string', maxLength: SUMMARY_LIMIT, description: 'The reader sees this instead of the article, which the app cannot fetch. Write 4–6 sentences (about 80–150 words) in your own words: what happened, who is involved, the specific numbers or findings, and why it matters. Not a headline restatement, not one line, and nothing the reporting does not support.' },
      category: { type: 'string', description: 'Short topical label used as the shelf kicker, e.g. "Energy".' },
    }, required: ['title', 'source', 'url', 'summary'], additionalProperties: false } } }, required: ['topic', 'stories'], additionalProperties: false }, annotations: { ...UNTRUSTED, destructiveHint: true }, execute: async ({ topic, stories, mode = 'replace' }) => injectNews(topic, stories, mode) },

    { name: 'discover-creators', title: 'Suggest blogs and creators to follow', description: 'Add researched blogs, newsletters, podcasts, and independent creators to the reader\'s Discover page. Requires a signed-in account. Favor primary homepages over aggregator profiles, verify the site is still publishing, and say plainly in whyRelevant what makes each one a fit. Nothing is subscribed automatically: the reader presses Subscribe. mode: "replace" only replaces creators discovered for this exact topic, never the whole Discover page. The app never fetches or opens the links you supply.', inputSchema: { type: 'object', properties: { topic: { type: 'string', maxLength: 120 }, mode: { type: 'string', enum: ['replace', 'append'] }, creators: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, feedUrl: { type: 'string' }, handle: { type: 'string' }, kind: { type: 'string', enum: ['blog', 'newsletter', 'podcast', 'video', 'magazine', 'independent'] }, cadence: { type: 'string' }, description: { type: 'string' }, whyRelevant: { type: 'string' }, topics: { type: 'array', maxItems: 4, items: { type: 'string' } } }, required: ['name', 'url'], additionalProperties: false } } }, required: ['topic', 'creators'], additionalProperties: false }, annotations: { ...UNTRUSTED, destructiveHint: true }, execute: async ({ topic, creators, mode = 'append' }) => addCreators(topic, creators, mode) },

    { name: 'get-current-feed', title: 'Read the 4.0-reads library', description: 'Read the signed-in reader\'s stories, shelves, saved stories, subscriptions, and discovered creators. Read-only. This decrypts in the page, so it works only while the reader is signed in on this device.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, ...UNTRUSTED }, execute: async () => ({ ...accountSnapshot(), ...library() }) },

    { name: 'save-story', title: 'Save a story to the account', description: 'Save a story that is already on the shelf so it stays in the reader\'s Saved list. Requires a signed-in account. Identify the story by its id from get-current-feed, or by its exact url.', inputSchema: { type: 'object', properties: { storyId: { type: 'string' }, url: { type: 'string' } }, additionalProperties: false }, annotations: { destructiveHint: false, idempotentHint: true }, execute: async ({ storyId, url }) => {
      requireAccount();
      const story = library().stories.find((entry) => entry.id === storyId || (url && entry.url === url));
      if (!story) throw new Error('No story on the shelf matches that id or url.');
      if (isSaved(story.id)) return { saved: true, alreadySaved: true, title: story.title };
      await toggleSave(story.id); render();
      toast(`Saved “${story.title}”.`);
      return { saved: true, title: story.title, savedCount: library().saved.length };
    } },

    { name: 'subscribe-to-source', title: 'Subscribe to a blog, creator, or source', description: 'Follow a blog, newsletter, or creator in the reader\'s account. Requires a signed-in account. Use the creator\'s own https homepage; one subscription is kept per site.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, kind: { type: 'string', enum: ['blog', 'newsletter', 'podcast', 'video', 'magazine', 'independent'] }, description: { type: 'string' } }, required: ['name', 'url'], additionalProperties: false }, annotations: { ...UNTRUSTED, destructiveHint: false, idempotentHint: true }, execute: async ({ name, url, kind = 'blog', description = '' }) => {
      requireAccount();
      if (isSubscribed(url)) return { subscribed: true, alreadySubscribed: true, name: subscriptionFor(url).name };
      const result = await toggleSubscription({ name, url, kind, description }); render();
      toast(`Subscribed to ${result.subscription.name}.`);
      return { subscribed: true, name: result.subscription.name, subscriptionCount: library().subscriptions.length };
    } },

    { name: 'unsubscribe-from-source', title: 'Unsubscribe from a source', description: 'Stop following a blog, newsletter, or creator in the reader\'s account. Requires a signed-in account.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false }, annotations: { destructiveHint: true }, execute: async ({ url }) => {
      requireAccount();
      if (!isSubscribed(url)) throw new Error('That source is not in your subscriptions.');
      const result = await toggleSubscription({ url, name: '' }); render();
      toast(`Unsubscribed from ${result.subscription.name}.`);
      return { subscribed: false, name: result.subscription.name, subscriptionCount: library().subscriptions.length };
    } },

    ...authTools,
  ];
  /* Each tool registers on its own: one bad or already-registered tool must not stop the
     rest, and a retry (another sign-in after a partial failure) must not re-throw
     InvalidStateError for names the browser already has. */
  for (const tool of tools) {
    if (registeredToolNames.has(tool.name)) continue;
    try { await document.modelContext.registerTool(tool); registeredToolNames.add(tool.name); }
    catch (error) { console.warn(`WebMCP tool "${tool.name}" failed to register:`, error); }
  }
  state.webmcp = { supported: true, registered: registeredToolNames.size };
  render();
}

/* Updates the form in place. A re-render would clear the fields the reader just typed. */
function setPassphraseFormState(form, { error = '', busy = false } = {}) {
  const message = form.querySelector('[data-role="passphrase-error"]');
  message.textContent = error;
  message.hidden = !error;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = busy;
  button.querySelector('[data-role="label"]').textContent = busy ? 'Re-wrapping your key…' : 'Change passphrase';
}

function validatePassphraseChange({ current, next, confirm, needsCurrent }) {
  if (needsCurrent && !current) return 'Enter your current passphrase.';
  if (next.length < 8 || !/[a-zA-Z]/.test(next) || !/[0-9]/.test(next)) return 'Use at least 8 characters, mixing letters and numbers.';
  if (next !== confirm) return 'The two new passphrases do not match.';
  if (needsCurrent && next === current) return 'That is already your passphrase.';
  return '';
}

/* ---------- events ---------- */
document.addEventListener('submit', async (event) => {
  const passphraseFormElement = event.target.closest('[data-form="passphrase"]');
  if (passphraseFormElement) {
    event.preventDefault();
    const button = passphraseFormElement.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const fields = new FormData(passphraseFormElement);
    const current = String(fields.get('current') || '');
    const next = String(fields.get('next') || '');
    const confirm = String(fields.get('confirm') || '');
    const problem = validatePassphraseChange({ current, next, confirm, needsCurrent: !store.needsNewPassphrase });
    if (problem) { setPassphraseFormState(passphraseFormElement, { error: problem }); return; }
    setPassphraseFormState(passphraseFormElement, { busy: true });
    rekeyInFlight = true;
    try {
      await store.changePassphrase({ current, next });
      /* A stale saved passphrase is worse than none: autofill would quietly stop unlocking. */
      await rememberCredential({ email: store.profile.email, name: store.profile.name, passphrase: next });
      state.view = 'library';
      render();
      toast('Passphrase changed. Other devices need the new one.');
    } catch (error) {
      setPassphraseFormState(passphraseFormElement, { error: error.message });
    } finally { rekeyInFlight = false; }
    return;
  }

  const passkeyFormElement = event.target.closest('[data-form="passkey"]');
  if (passkeyFormElement) {
    event.preventDefault();
    const button = passkeyFormElement.querySelector('button[type="submit"]');
    if (button.disabled) return;
    /* Updated in place, like the passphrase form: a re-render would clear the field. */
    const message = passkeyFormElement.querySelector('[data-role="passkey-error"]');
    const label = button.querySelector('[data-role="label"]');
    const current = String(new FormData(passkeyFormElement).get('current') || '');
    message.hidden = true; button.disabled = true; label.textContent = 'Waiting for your device…';
    try {
      await store.addPasskey({ current });
      render();
      toast('Passkey added. You can unlock with it next time.');
    } catch (error) {
      /* Dismissing the device prompt is a decision, not a failure worth shouting about. */
      if (error.name !== 'NotAllowedError') { message.textContent = error.message; message.hidden = false; }
      button.disabled = false; label.textContent = 'Add a passkey';
    }
    return;
  }

  const form = event.target.closest('[data-form="auth"]');
  if (!form) return;
  event.preventDefault();
  if (state.authBusy) return;
  const fields = new FormData(form);
  const payload = {
    name: String(fields.get('name') || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    email: String(fields.get('email') || '').trim(),
    passphrase: String(fields.get('passphrase') || ''),
    recoveryKey: String(fields.get('recoveryKey') || ''),
  };
  if (state.authMode === 'signup') {
    if (payload.passphrase.length < 8 || !/[a-zA-Z]/.test(payload.passphrase) || !/[0-9]/.test(payload.passphrase)) {
      state.authError = 'Use at least 8 characters, mixing letters and numbers.';
      state.authDraft = { name: payload.name, email: payload.email };
      render(); return;
    }
  }
  state.authDraft = { name: payload.name, email: payload.email };
  state.authBusy = true; state.authError = ''; render();
  try {
    if (state.authMode === 'signup') await signUp(payload);
    else if (state.authMode === 'recover') await recoverAccount(payload);
    else await signIn(payload);
  } catch (error) { state.authError = error.message; }
  finally { state.authBusy = false; render(); }
});

/* Replaces the inline onerror the content security policy forbids. Error events do not
   bubble, so this has to listen during capture. */
document.addEventListener('error', (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.dataset.fallback === 'remove') image.remove();
}, true);

document.addEventListener('change', (event) => {
  const box = event.target.closest('[data-action="confirm-recovery"]');
  if (!box) return;
  const button = document.querySelector('[data-action="finish-recovery"]');
  if (button) button.disabled = !box.checked;
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, folder, story, url, name, kind, mode } = button.dataset;

  if (action === 'noop') { event.preventDefault(); return; }
  /* Owned by the change listener; re-rendering here would clear the checkbox. */
  if (action === 'confirm-recovery') return;
  /* Leaving mid-re-key would strand the operation with nowhere to report a failure. */
  if (rekeyInFlight && action !== 'copy-recovery') { event.preventDefault(); toast('Finishing your passphrase change first.'); return; }
  if (action === 'auth-mode') { state.authMode = mode; state.authError = ''; render(); return; }
  /* The chooser is browser UI, and this is the reader's own click — see signInWithSavedCredential. */
  if (action === 'use-saved-credential') { await signInWithSavedCredential(); return; }
  if (action === 'unlock-passkey') { await unlockWithPasskeyFromForm(); return; }
  if (action === 'remove-passkey') {
    try { await store.removePasskey(button.dataset.passkey); toast('Passkey removed.'); }
    catch (error) { toast(error.message); }
    render(); return;
  }
  if (action === 'copy-recovery') { navigator.clipboard?.writeText(formatRecoveryKey(state.recoveryKey)).then(() => toast('Recovery key copied.'), () => toast('Copy failed — write it down instead.')); return; }
  if (action === 'finish-recovery') { state.recoveryKey = ''; state.view = 'library'; toast(`Welcome, ${store.profile.name}.`); render(); return; }
  if (action === 'sign-out') { await signOut(); toast('Signed out. Your library stays encrypted on the server.'); return; }

  if (action === 'open-all') { event.preventDefault(); state.activeFolder = 'all'; state.view = 'library'; }
  if (action === 'open-saved') { state.activeFolder = 'saved'; state.view = 'library'; }
  if (action === 'open-discover') { state.view = 'discover'; }
  if (action === 'open-account') { state.view = 'account'; }
  if (action === 'open-folder') { state.activeFolder = folder; state.view = 'library'; }
  if (action === 'open-reader') { state.selectedStoryId = story; state.view = 'reader'; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (action === 'back-to-library') { state.view = 'library'; state.selectedStoryId = null; }
  if (action === 'increase-font') { updateSettings({ fontScale: Math.min(1.22, Number((settings().fontScale + 0.06).toFixed(2))) }).catch(reportError); }
  if (action === 'decrease-font') { updateSettings({ fontScale: Math.max(0.88, Number((settings().fontScale - 0.06).toFixed(2))) }).catch(reportError); }
  if (action === 'toggle-theme') { updateSettings({ theme: settings().theme === 'night' ? 'paper' : 'night' }).catch(reportError); }

  if (action === 'toggle-save') {
    try { const result = await toggleSave(story); toast(result.saved ? `Saved “${result.story.title}”.` : 'Removed from Saved.'); }
    catch (error) { toast(error.message); }
  }
  if (action === 'toggle-subscribe') {
    try { const result = await toggleSubscription({ name, url, kind }); toast(result.subscribed ? `Subscribed to ${result.subscription.name}.` : `Unsubscribed from ${result.subscription.name}.`); }
    catch (error) { toast(error.message); }
  }
  if (action === 'new-folder') {
    const label = window.prompt('Name this shelf');
    if (label) { try { const created = await ensureFolder(label); if (created) { state.activeFolder = created.id; state.view = 'library'; toast(`Created ${created.name}.`); } } catch (error) { toast(error.message); } }
  }
  if (action === 'rename-folder') {
    const current = library().folders.find((entry) => entry.id === folder);
    const label = current && window.prompt('Rename this shelf', current.name);
    if (label && current) {
      try { await store.put({ ...current, name: titleFor(label), slug: slugFor(label) }); toast('Shelf renamed.'); }
      catch (error) { toast(error.message); }
    }
  }
  render();
});

/* ---------- boot ---------- */
(async function boot() {
  render();
  try { await store.restore(); }
  catch (error) { console.warn('Could not restore session:', error); }
  finally { state.booting = false; render(); }
  registerWebMcpTools();
})();
