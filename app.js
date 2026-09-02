import { normalizeStories, normalizeCreators } from './src/data.js';
import { createCredential, verifyCredential, validateEmail, accountId, scopedKey, publicProfile, normalizeName } from './src/account.js';

const ACCOUNTS_KEY = '4.0-reads-accounts-v1';
const SESSION_KEY = '4.0-reads-session-v1';
const LEGACY_FEED_KEYS = ['4.0-news-feed-v1', 'signal-news-feed-v2'];
const LEGACY_FOLDERS_KEY = '4.0-news-folders-v1';
const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');

const emptyLibrary = () => ({ feed: [], folders: [], saved: [], subscriptions: [], creators: [], reading: { theme: 'paper', fontScale: 1 } });
const state = { account: null, data: emptyLibrary(), activeFolder: 'all', view: 'library', selectedStoryId: null, newStoryIds: [], authMode: 'signin', authError: '', authBusy: false, authDraft: { name: '', email: '' }, webmcp: { supported: false, registered: 0 } };
let toolsRegistered = false;

/* ---------- storage ---------- */
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } }
function accounts() { const stored = load(ACCOUNTS_KEY, []); return Array.isArray(stored) ? stored : []; }
function saveAccounts(list) { write(ACCOUNTS_KEY, list); }
function loadLibrary(id) { const stored = load(scopedKey(id, 'library'), null); return stored && typeof stored === 'object' ? { ...emptyLibrary(), ...stored } : emptyLibrary(); }
function save() { if (state.account) write(scopedKey(state.account.id, 'library'), state.data); }

/* ---------- helpers ---------- */
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
function hostOf(value) { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; } }
function date(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Recently' : new Intl.DateTimeFormat('en-US', options).format(parsed); }
function today() { return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()); }
function keyFor(value) { return String(value).trim().toLocaleLowerCase().replace(/\s+/g, ' ').slice(0, 60); }
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
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8 6 12l4 4M6 12h9"/></svg>',
}; return icons[name] || ''; }
function toast(message) { const element = document.createElement('div'); element.className = 'toast'; element.textContent = message; toastRegion.append(element); setTimeout(() => element.remove(), 2800); }

/* ---------- account session ---------- */
function requireAccount() { if (!state.account) throw new Error('Sign in to 4.0-reads first. Saving stories and subscribing both need an account.'); return state.account; }
function adoptLegacyLibrary() { const legacyFeed = LEGACY_FEED_KEYS.map((key) => load(key, null)).find((value) => Array.isArray(value) && value.length); if (!legacyFeed) return false; state.data.feed = legacyFeed; state.data.folders = load(LEGACY_FOLDERS_KEY, []) || []; return true; }
function startSession(account, { adoptLegacy = false } = {}) {
  state.account = publicProfile(account);
  state.data = loadLibrary(account.id);
  if (adoptLegacy && !state.data.feed.length && adoptLegacyLibrary()) toast('Your earlier shelf moved into this account.');
  state.activeFolder = 'all'; state.view = 'library'; state.selectedStoryId = null; state.authError = '';
  write(SESSION_KEY, account.id);
  migrateExistingStories(); save(); render(); registerWebMcpTools();
}
function endSession() { state.account = null; state.data = emptyLibrary(); state.view = 'library'; state.authMode = 'signin'; state.selectedStoryId = null; try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } render(); }
function restoreSession() { const id = load(SESSION_KEY, null); const account = accounts().find((entry) => entry.id === id); if (account) startSession(account); }

async function signUp({ name, email, passphrase }) {
  const list = accounts();
  if (list.some((entry) => entry.id === accountId(email))) throw new Error('That email already has an account here. Sign in instead.');
  const account = await createCredential(email, passphrase, name);
  saveAccounts([...list, account]);
  state.authDraft = { name: '', email: '' };
  startSession(account, { adoptLegacy: true });
  toast(`Welcome, ${account.name}.`);
}
async function signIn({ email, passphrase }) {
  const validEmail = validateEmail(email);
  const account = validEmail && accounts().find((entry) => entry.id === accountId(validEmail));
  if (!account || !(await verifyCredential(account, passphrase))) throw new Error('That email and passphrase do not match an account on this device.');
  state.authDraft = { name: '', email: '' };
  startSession(account);
  toast(`Welcome back, ${account.name}.`);
}

/* ---------- library data ---------- */
function ensureFolder(name, curated = true) { const title = titleFor(name); const id = keyFor(title); if (!title || !id) return null; let folder = state.data.folders.find((entry) => entry.id === id); if (!folder) { folder = { id, name: title, curated, createdAt: new Date().toISOString() }; state.data.folders.unshift(folder); } return folder; }
function migrateExistingStories() { state.data.feed.forEach((story) => { const names = story.tagNames || story.tags || [story.folderName || story.category || 'Reading']; const tags = names.map((name) => ensureFolder(name)).filter(Boolean); story.tagIds = tags.map((tag) => tag.id); story.tagNames = tags.map((tag) => tag.name); story.folderId = story.tagIds[0] || story.folderId; story.folderName = story.tagNames[0] || story.folderName; }); }
function storiesForFolder() { const { feed } = state.data; if (state.activeFolder === 'all') return feed; if (state.activeFolder === 'saved') return feed.filter((story) => isSaved(story.id)); return feed.filter((story) => (story.tagIds || [story.folderId]).includes(state.activeFolder)); }
function folderCount(id) { return state.data.feed.filter((story) => (story.tagIds || [story.folderId]).includes(id)).length; }
function isSaved(storyId) { return state.data.saved.some((entry) => entry.storyId === storyId); }
function subscriptionFor(url) { const host = hostOf(url); return state.data.subscriptions.find((entry) => entry.host === host); }
function isSubscribed(url) { return Boolean(subscriptionFor(url)); }

function toggleSave(storyId) {
  requireAccount();
  const story = state.data.feed.find((entry) => entry.id === storyId);
  if (!story) throw new Error('That story is not on your shelf.');
  if (isSaved(storyId)) { state.data.saved = state.data.saved.filter((entry) => entry.storyId !== storyId); save(); return { saved: false, story }; }
  state.data.saved = [{ storyId, title: story.title, url: story.url, source: story.source, savedAt: new Date().toISOString() }, ...state.data.saved];
  save();
  return { saved: true, story };
}

function toggleSubscription({ name, url, kind = 'blog', topics = [], description = '' }) {
  requireAccount();
  const host = hostOf(url);
  if (!host) throw new Error('A subscription needs a valid https source URL.');
  const existing = subscriptionFor(url);
  if (existing) { state.data.subscriptions = state.data.subscriptions.filter((entry) => entry.host !== host); save(); return { subscribed: false, subscription: existing }; }
  const subscription = { id: `sub-${host.replace(/[^a-z0-9]+/gi, '-')}`, host, name: titleFor(name) || host, url: safeUrl(url), kind, topics, description, subscribedAt: new Date().toISOString() };
  state.data.subscriptions = [subscription, ...state.data.subscriptions];
  save();
  return { subscribed: true, subscription };
}

function injectNews(topic, stories, mode = 'replace') {
  requireAccount();
  const normalized = normalizeStories(topic, stories);
  if (!normalized.length) throw new Error('No valid stories were supplied. Each story needs a title, source, and https URL.');
  const enriched = normalized.map((story) => { const names = story.tags?.length ? story.tags : [story.category || topic]; const tags = names.map((name) => ensureFolder(name, true)).filter(Boolean); return { ...story, tagIds: tags.map((tag) => tag.id), tagNames: tags.map((tag) => tag.name), folderId: tags[0]?.id, folderName: tags[0]?.name }; });
  state.data.feed = mode === 'append' ? [...enriched, ...state.data.feed.filter((story) => !enriched.some((entry) => entry.url === story.url))] : enriched;
  state.activeFolder = enriched[0]?.tagIds[0] || 'all';
  state.newStoryIds = enriched.map((story) => story.id);
  state.view = 'library'; save(); render();
  setTimeout(() => { state.newStoryIds = []; }, 900);
  toast(`${enriched.length} ${enriched.length === 1 ? 'story' : 'stories'} added to your shelf.`);
  return { topic, tags: [...new Set(enriched.flatMap((story) => story.tagNames))], mode, added: enriched, feedCount: state.data.feed.length, note: 'Stories are on the shelf but not saved yet — the reader saves each one with the Save button.' };
}

function addCreators(topic, creators, mode = 'append') {
  requireAccount();
  const normalized = normalizeCreators(topic, creators);
  if (!normalized.length) throw new Error('No valid creators were supplied. Each one needs a name and an https URL.');
  state.data.creators = mode === 'replace' ? normalized : [...normalized, ...state.data.creators.filter((creator) => !normalized.some((entry) => entry.id === creator.id))];
  state.view = 'discover'; save(); render();
  toast(`${normalized.length} ${normalized.length === 1 ? 'creator' : 'creators'} to explore.`);
  return { topic, mode, added: normalized, creatorCount: state.data.creators.length, note: 'Nothing is subscribed automatically — the reader subscribes with the Subscribe button.' };
}

/* ---------- views ---------- */
function authView() {
  const isSignUp = state.authMode === 'signup';
  return `<div class="auth-page"><section class="auth-hero"><a class="brand" href="#" data-action="noop"><span>4.0</span><strong>reads</strong></a><p class="eyebrow">News, blogs, and the people behind them</p><h1>Your shelf<br><em>needs a name.</em></h1><p class="auth-lead">An account keeps your saved stories, your shelves, and everyone you subscribe to in one place — and lets your AI assistant fill them for you through WebMCP.</p><ul class="auth-points"><li>${icon('bookmark')}<span><strong>Save</strong> any story to come back to it.</span></li><li>${icon('bell')}<span><strong>Subscribe</strong> to blogs, newsletters, and independent creators.</span></li><li>${icon('sparkle')}<span><strong>Discover</strong> new voices with AI research, kept with their sources.</span></li></ul></section>
  <section class="auth-panel"><div class="auth-tabs"><button class="${isSignUp ? '' : 'active'}" data-action="auth-mode" data-mode="signin">Sign in</button><button class="${isSignUp ? 'active' : ''}" data-action="auth-mode" data-mode="signup">Create account</button></div>
  <form class="auth-form" data-form="auth" novalidate>${isSignUp ? `<label>Name<input name="name" type="text" autocomplete="name" value="${escapeHtml(state.authDraft.name)}" placeholder="What should we call you?" /></label>` : ''}
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escapeHtml(state.authDraft.email)}" placeholder="you@example.com" /></label>
  <label>Passphrase<input name="passphrase" type="password" autocomplete="${isSignUp ? 'new-password' : 'current-password'}" required placeholder="At least 8 characters with a number" /></label>
  ${state.authError ? `<p class="auth-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
  <button class="primary-button auth-submit" type="submit" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'One moment…' : isSignUp ? 'Create account' : 'Sign in'} ${icon('arrow')}</button></form>
  <p class="auth-note">Accounts live in this browser only. Your passphrase is stretched with PBKDF2-SHA-256 and never stored in the clear, but this is a local shelf — do not reuse an important password.</p></section></div>`;
}

function accountChip() { const name = state.account?.name || 'Reader'; return `<div class="account-chip"><span class="reader-mark">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(state.account?.email || '')}</small></div><button data-action="sign-out" aria-label="Sign out">${icon('logout')}</button></div>`; }
function folderRow(folder) { return `<div class="folder-wrap"><button class="folder ${state.activeFolder === folder.id && state.view === 'library' ? 'active' : ''}" data-action="open-folder" data-folder="${escapeHtml(folder.id)}">${icon('folder')}<span>${escapeHtml(folder.name)}</span><b>${folderCount(folder.id)}</b></button><button class="folder-menu" data-action="rename-folder" data-folder="${escapeHtml(folder.id)}" aria-label="Rename ${escapeHtml(folder.name)}">${icon('dots')}</button></div>`; }
function sidebar() { const { feed, saved, folders, subscriptions } = state.data; const libraryActive = state.view === 'library'; return `<aside class="sidebar"><a class="brand" href="#" data-action="open-all"><span>4.0</span><strong>reads</strong></a>
  <nav class="primary-nav" aria-label="Sections"><button class="nav-link ${libraryActive ? 'active' : ''}" data-action="open-all">${icon('book')}<span>Library</span></button><button class="nav-link ${state.view === 'discover' ? 'active' : ''}" data-action="open-discover">${icon('compass')}<span>Discover</span><b>${state.data.creators.length || ''}</b></button></nav>
  <div class="library-title"><span>Library</span><button data-action="new-folder" aria-label="Create shelf">${icon('plus')}</button></div>
  <nav class="library" aria-label="Reading shelves"><button class="folder ${libraryActive && state.activeFolder === 'all' ? 'active' : ''}" data-action="open-all">${icon('inbox')}<span>All stories</span><b>${feed.length}</b></button><button class="folder ${libraryActive && state.activeFolder === 'saved' ? 'active' : ''}" data-action="open-saved">${icon('bookmark')}<span>Saved</span><b>${saved.length}</b></button>${folders.map(folderRow).join('')}</nav>
  <div class="library-title"><span>Subscriptions</span><b class="count-pill">${subscriptions.length}</b></div>
  <nav class="library" aria-label="Subscriptions">${subscriptions.length ? subscriptions.slice(0, 6).map((entry) => `<a class="folder sub-row" href="${escapeHtml(safeUrl(entry.url))}" target="_blank" rel="noreferrer">${icon('bellFill')}<span>${escapeHtml(entry.name)}</span></a>`).join('') : '<p class="sidebar-empty">Subscribe from any story or creator card.</p>'}</nav>
  <div class="sidebar-spacer"></div>${accountChip()}</aside>`; }

function faviconFor(story) { const host = hostOf(story.url); return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=96` : ''; }
function storyImage(story) { return story.imageUrl ? safeUrl(story.imageUrl) : faviconFor(story); }
function storyMeta(story) { return `<div class="story-meta"><span>${escapeHtml(story.source)}</span><i></i><span>${date(story.publishedAt)}</span></div>`; }
function cover(story, large = false) { const image = storyImage(story); const mark = escapeHtml(initials(story.source)); return `<div class="cover ${large ? 'cover-large' : ''} ${story.imageUrl ? '' : 'cover-logo'}"><span>${mark}</span>${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}</div>`; }
function saveButton(story, wide = false) { const saved = isSaved(story.id); return `<button class="pill-button ${saved ? 'is-on' : ''} ${wide ? 'pill-wide' : ''}" data-action="toggle-save" data-story="${escapeHtml(story.id)}" aria-pressed="${saved}">${icon(saved ? 'bookmarkFill' : 'bookmark')}<span>${saved ? 'Saved' : 'Save'}</span></button>`; }
function subscribeButton(source, wide = false) { const on = isSubscribed(source.url); return `<button class="pill-button ${on ? 'is-on' : ''} ${wide ? 'pill-wide' : ''}" data-action="toggle-subscribe" data-url="${escapeHtml(source.url)}" data-name="${escapeHtml(source.name)}" data-kind="${escapeHtml(source.kind || 'blog')}" aria-pressed="${on}">${icon(on ? 'check' : 'bell')}<span>${on ? 'Subscribed' : 'Subscribe'}</span></button>`; }
function storyActions(story, wide = false) { return `<div class="card-actions">${saveButton(story, wide)}${subscribeButton({ url: story.url, name: story.source, kind: 'blog' }, wide)}</div>`; }

function emptyFeed() { return `<section class="empty-feed"><div class="empty-book">${icon('book')}</div><p class="eyebrow">A blank first page</p><h2>Save something worth staying with.</h2><p>Ask your assistant for news on a topic, or head to Discover to find blogs and independent creators worth following.</p><span class="empty-hint">Sources, dates, and context stay attached.</span></section>`; }
function storyCard(story, index) { const isNew = state.newStoryIds.includes(story.id); return `<article class="story-card ${isNew ? 'story-arriving' : ''}" style="--arrival-index:${index}"><button class="cover-button" data-action="open-reader" data-story="${escapeHtml(story.id)}" aria-label="Open ${escapeHtml(story.title)}">${cover(story)}</button><div class="story-card-copy"><p class="story-kicker">${escapeHtml(story.folderName || story.category || 'Reading')}</p><h3>${escapeHtml(story.title)}</h3><p class="summary">${escapeHtml(story.summary)}</p>${storyActions(story)}<footer>${storyMeta(story)}<button class="read-link" data-action="open-reader" data-story="${escapeHtml(story.id)}">Read ${icon('arrow')}</button></footer></div></article>`; }
function continueCard(story) { return `<section class="continue-card"><div class="continue-cover">${cover(story, true)}</div><div class="continue-copy"><p class="eyebrow">Continue reading</p><h2>${escapeHtml(story.title)}</h2><p class="continue-source">${escapeHtml(story.source)} <span>·</span> ${date(story.publishedAt)}</p><p class="summary">${escapeHtml(story.summary)}</p><div class="continue-actions"><button class="primary-button" data-action="open-reader" data-story="${escapeHtml(story.id)}">Open story ${icon('arrow')}</button>${storyActions(story)}</div></div></section>`; }

function libraryView() {
  const stories = storiesForFolder();
  const currentFolder = state.data.folders.find((folder) => folder.id === state.activeFolder);
  const heading = state.activeFolder === 'saved' ? 'Saved' : currentFolder ? currentFolder.name : 'All stories';
  const lead = stories[0]; const rest = stories.slice(1);
  return `<div class="shell">${sidebar()}<main class="library-main"><header class="topbar"><span>${today()}</span><span class="page-count">${stories.length} ${stories.length === 1 ? 'story' : 'stories'}</span></header>
  <section class="library-hero"><p class="eyebrow">${escapeHtml(state.account.name)}'s reading shelf</p><h1>Make room for<br><em>good stories.</em></h1><p>Reporting, blogs, and independent voices — saved with their source and ready when you are.</p></section>
  ${lead ? continueCard(lead) : emptyFeed()}
  <section class="shelf-heading"><div><p class="eyebrow">${escapeHtml(heading)}</p><h2>On your shelf</h2></div><span>${stories.length ? 'Newest first' : 'Nothing here yet'}</span></section>
  ${rest.length ? `<section class="story-grid">${rest.map(storyCard).join('')}</section>` : ''}</main>
  <aside class="library-aside"><div class="aside-block"><p class="eyebrow">Reading rhythm</p><div class="rhythm-number">${state.data.saved.length}</div><p>stories saved<br>from ${state.data.feed.length} on your shelf</p></div><div class="aside-block"><p class="eyebrow">Following</p><div class="rhythm-number">${state.data.subscriptions.length}</div><p>${state.data.subscriptions.length === 1 ? 'blog or creator' : 'blogs and creators'}<br>you subscribe to</p></div><div class="aside-block aside-note"><span>${icon('bookmark')}</span><p>Every story keeps its original source, publication date, and a direct path back to the reporting.</p></div><div class="aside-footer">${state.webmcp.supported ? `WebMCP ready · ${state.webmcp.registered} tools` : 'Library ready'}</div></aside></div>`;
}

function creatorCard(creator, index) { return `<article class="creator-card" style="--arrival-index:${index}"><div class="creator-head"><div class="creator-mark">${escapeHtml(initials(creator.name))}</div><div><h3>${escapeHtml(creator.name)}</h3><p class="creator-host"><em>${escapeHtml(creator.kind)}</em> <span>·</span> ${escapeHtml(hostOf(creator.url) || 'source')}${creator.cadence ? ` <span>·</span> ${escapeHtml(creator.cadence)}` : ''}</p></div></div><p class="summary">${escapeHtml(creator.description)}</p>${creator.whyRelevant ? `<p class="creator-why">${icon('sparkle')}<span>${escapeHtml(creator.whyRelevant)}</span></p>` : ''}<div class="creator-topics">${creator.topics.map((topic) => `<span>${escapeHtml(topic)}</span>`).join('')}</div><div class="card-actions">${subscribeButton(creator)}<a class="read-link" href="${escapeHtml(safeUrl(creator.url))}" target="_blank" rel="noreferrer">Visit ${icon('arrow')}</a></div></article>`; }
function discoverView() {
  const { creators, subscriptions } = state.data;
  return `<div class="shell">${sidebar()}<main class="library-main"><header class="topbar"><span>${today()}</span><span class="page-count">${creators.length} ${creators.length === 1 ? 'creator' : 'creators'}</span></header>
  <section class="library-hero"><p class="eyebrow">Discover</p><h1>Find the people<br><em>worth following.</em></h1><p>Ask your assistant to research blogs, newsletters, and independent creators on a topic. They arrive here with their sources — you decide who to subscribe to.</p></section>
  ${creators.length ? `<section class="shelf-heading"><div><p class="eyebrow">Researched for you</p><h2>Blogs &amp; creators</h2></div><span>${subscriptions.length} subscribed</span></section><section class="creator-grid">${creators.map(creatorCard).join('')}</section>` : `<section class="empty-feed"><div class="empty-book">${icon('compass')}</div><p class="eyebrow">Nothing discovered yet</p><h2>Who should you be reading?</h2><p>Try asking: <em>“find me three independent blogs about urban design”</em>. Results land here through the <code>discover-creators</code> WebMCP tool.</p><span class="empty-hint">The app never fetches or opens the links it is given.</span></section>`}
  ${subscriptions.length ? `<section class="shelf-heading"><div><p class="eyebrow">Your subscriptions</p><h2>Following</h2></div><span>Kept with your account</span></section><section class="sub-grid">${subscriptions.map((entry) => `<div class="sub-card"><div class="creator-mark">${escapeHtml(initials(entry.name))}</div><div class="sub-copy"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.host)} · since ${date(entry.subscribedAt)}</small></div>${subscribeButton(entry)}</div>`).join('')}</section>` : ''}</main>
  <aside class="library-aside"><div class="aside-block"><p class="eyebrow">Following</p><div class="rhythm-number">${subscriptions.length}</div><p>subscriptions saved<br>to ${escapeHtml(state.account.name)}'s account</p></div><div class="aside-block aside-note"><span>${icon('sparkle')}</span><p>Discovery is research, not endorsement. Each card keeps the creator's own site so you can judge for yourself.</p></div><div class="aside-footer">${state.webmcp.supported ? `WebMCP ready · ${state.webmcp.registered} tools` : 'Discovery ready'}</div></aside></div>`;
}

function readerSections(story) { const summary = story.summary || `This story was saved from ${story.source}.`; const paragraphs = summary.split(/(?<=[.!?])\s+/).filter(Boolean); return paragraphs.length > 1 ? paragraphs : [summary]; }
function readerView(story) {
  const paragraphs = readerSections(story);
  const { theme, fontScale } = state.data.reading;
  return `<div class="reader-page reader-theme-${theme}" style="--reader-scale:${fontScale}"><header class="reader-topbar"><button class="back-button" aria-label="Back to shelf" data-action="back-to-library">${icon('back')}<span>Back to shelf</span></button><div class="reader-title">${escapeHtml(story.folderName || story.category || 'Saved story')}</div><div class="reader-tools"><button data-action="decrease-font" aria-label="Decrease text size">A−</button><button data-action="increase-font" aria-label="Increase text size">A+</button><button data-action="toggle-theme" aria-label="Toggle reading theme">${theme === 'night' ? icon('sun') : icon('moon')}</button><a href="${escapeHtml(safeUrl(story.url))}" target="_blank" rel="noreferrer" class="source-link">Source ${icon('arrow')}</a></div></header>
  <div class="reading-progress"><span style="width:32%"></span></div>
  <div class="reader-layout"><aside class="reader-rail"><p class="eyebrow">In this story</p><ol><li class="active">The story</li><li>Source notes</li></ol><div class="rail-rule"></div><span class="rail-meta">${date(story.publishedAt, { month: 'long', day: 'numeric', year: 'numeric' })}</span><span class="rail-meta">12 min read</span></aside>
  <article class="article"><p class="eyebrow">${escapeHtml(story.source)} <span class="eyebrow-dot">·</span> ${date(story.publishedAt)}</p><h1>${escapeHtml(story.title)}</h1><p class="article-dek">A source-preserved entry from ${escapeHtml(story.source)}, added on ${date(story.publishedAt, { month: 'long', day: 'numeric', year: 'numeric' })}.</p><div class="article-rule"></div><div class="article-body"><p class="dropcap">${escapeHtml(paragraphs[0])}</p>${paragraphs.slice(1).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}<h2>Source notes</h2><p>This entry is preserved with its original publication date and source. Read the full reporting at <a href="${escapeHtml(safeUrl(story.url))}" target="_blank" rel="noreferrer">${escapeHtml(story.source)}</a>.</p></div><footer class="article-footer"><button data-action="back-to-library">${icon('back')} Back to shelf</button><a href="${escapeHtml(safeUrl(story.url))}" target="_blank" rel="noreferrer">Read original ${icon('arrow')}</a></footer></article>
  <aside class="reader-side"><div class="reader-cover">${cover(story, true)}</div><p class="side-label">Saved in</p><strong>${escapeHtml(story.folderName || story.category || 'All stories')}</strong><div class="side-rule"></div><div class="side-actions">${saveButton(story, true)}${subscribeButton({ url: story.url, name: story.source }, true)}</div><p class="side-caption">Saving keeps it on ${escapeHtml(state.account.name)}'s shelf. Subscribing follows everything from ${escapeHtml(hostOf(story.url) || story.source)}.</p></aside></div></div>`;
}

function render() {
  if (!state.account) { app.innerHTML = authView(); const firstField = app.querySelector('input[name="name"], input[name="email"]'); if (firstField && document.activeElement?.tagName !== 'INPUT') firstField.focus(); return; }
  const story = state.data.feed.find((entry) => entry.id === state.selectedStoryId);
  if (state.view === 'reader' && story) app.innerHTML = readerView(story);
  else if (state.view === 'discover') app.innerHTML = discoverView();
  else { state.view = 'library'; app.innerHTML = libraryView(); }
}

/* ---------- WebMCP ---------- */
const UNTRUSTED = { untrustedContentHint: true };
function accountSnapshot() { return { signedIn: Boolean(state.account), account: state.account, savedCount: state.data.saved.length, subscriptionCount: state.data.subscriptions.length, feedCount: state.data.feed.length }; }

async function registerWebMcpTools() {
  if (!document.modelContext?.registerTool || toolsRegistered) return;
  toolsRegistered = true;
  const tools = [
    { name: 'get-account-status', title: 'Check the 4.0-reads account', description: 'Report whether a reader is signed in to 4.0-reads and how much is in their library. Call this before saving, subscribing, or adding stories: every write tool fails while signed out, and only the person at the keyboard can sign in.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async () => accountSnapshot() },
    { name: 'inject-news-to-feed', title: 'Add web-researched news to 4.0-reads', description: 'Create or update a personal topic shelf with selected web-researched articles. Requires a signed-in account. Search fast and favor trustworthy primary reporting published in the last 24–48 hours; a story older than 7 days should only appear when it is essential context, and month-old stories are normally out of scope. Prefer direct source pages, verify publication time, avoid duplicates, and keep the result set concise. Provide imageUrl when a relevant article image is available; otherwise the shelf uses the source site favicon. Stories arrive unsaved — the reader chooses what to save. The app never fetches or opens article links.', inputSchema: { type: 'object', properties: { topic: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] }, stories: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', properties: { title: { type: 'string' }, source: { type: 'string' }, url: { type: 'string' }, imageUrl: { type: 'string' }, publishedAt: { type: 'string' }, summary: { type: 'string' }, category: { type: 'string' } }, required: ['title', 'source', 'url'], additionalProperties: false } } }, required: ['topic', 'stories'], additionalProperties: false }, annotations: UNTRUSTED, execute: async ({ topic, stories, mode = 'replace' }) => injectNews(topic, stories, mode) },
    { name: 'discover-creators', title: 'Suggest blogs and creators to follow', description: 'Add researched blogs, newsletters, podcasts, and independent creators to the reader\'s Discover page. Requires a signed-in account. Favor primary homepages over aggregator profiles, verify the site is still publishing, and say plainly in whyRelevant what makes each one a fit. Nothing is subscribed automatically: the reader presses Subscribe. The app never fetches or opens the links you supply.', inputSchema: { type: 'object', properties: { topic: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] }, creators: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, feedUrl: { type: 'string' }, handle: { type: 'string' }, kind: { type: 'string', enum: ['blog', 'newsletter', 'podcast', 'video', 'magazine', 'independent'] }, cadence: { type: 'string' }, description: { type: 'string' }, whyRelevant: { type: 'string' }, topics: { type: 'array', maxItems: 4, items: { type: 'string' } } }, required: ['name', 'url'], additionalProperties: false } } }, required: ['topic', 'creators'], additionalProperties: false }, annotations: UNTRUSTED, execute: async ({ topic, creators, mode = 'append' }) => addCreators(topic, creators, mode) },
    { name: 'get-current-feed', title: 'Read the 4.0-reads library', description: 'Read the signed-in reader\'s stories, shelves, saved stories, and subscriptions. Read-only, and empty while signed out.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, ...UNTRUSTED }, execute: async () => ({ ...accountSnapshot(), stories: state.data.feed, folders: state.data.folders, saved: state.data.saved, subscriptions: state.data.subscriptions, creators: state.data.creators }) },
    { name: 'save-story', title: 'Save a story to the account', description: 'Save a story that is already on the shelf so it stays in the reader\'s Saved list. Requires a signed-in account. Identify the story by its id from get-current-feed, or by its exact url.', inputSchema: { type: 'object', properties: { storyId: { type: 'string' }, url: { type: 'string' } }, additionalProperties: false }, execute: async ({ storyId, url }) => { requireAccount(); const story = state.data.feed.find((entry) => entry.id === storyId || (url && entry.url === url)); if (!story) throw new Error('No story on the shelf matches that id or url.'); if (isSaved(story.id)) return { saved: true, alreadySaved: true, story }; const result = toggleSave(story.id); render(); toast(`Saved “${story.title}”.`); return { saved: result.saved, story, savedCount: state.data.saved.length }; } },
    { name: 'subscribe-to-source', title: 'Subscribe to a blog, creator, or source', description: 'Follow a blog, newsletter, or creator in the reader\'s account. Requires a signed-in account. Use the creator\'s own https homepage; one subscription is kept per site.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, kind: { type: 'string', enum: ['blog', 'newsletter', 'podcast', 'video', 'magazine', 'independent'] }, description: { type: 'string' } }, required: ['name', 'url'], additionalProperties: false }, annotations: UNTRUSTED, execute: async ({ name, url, kind = 'blog', description = '' }) => { requireAccount(); if (isSubscribed(url)) return { subscribed: true, alreadySubscribed: true, subscription: subscriptionFor(url) }; const result = toggleSubscription({ name, url, kind, description }); render(); toast(`Subscribed to ${result.subscription.name}.`); return { ...result, subscriptionCount: state.data.subscriptions.length }; } },
    { name: 'unsubscribe-from-source', title: 'Unsubscribe from a source', description: 'Stop following a blog, newsletter, or creator in the reader\'s account. Requires a signed-in account.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false }, execute: async ({ url }) => { requireAccount(); if (!isSubscribed(url)) throw new Error('That source is not in your subscriptions.'); const result = toggleSubscription({ url, name: '' }); render(); toast(`Unsubscribed from ${result.subscription.name}.`); return { subscribed: false, subscription: result.subscription, subscriptionCount: state.data.subscriptions.length }; } },
  ];
  try { for (const tool of tools) await document.modelContext.registerTool(tool); state.webmcp = { supported: true, registered: tools.length }; render(); }
  catch (error) { toolsRegistered = false; console.warn('WebMCP registration unavailable:', error); }
}

/* ---------- events ---------- */
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-form="auth"]');
  if (!form) return;
  event.preventDefault();
  if (state.authBusy) return;
  const fields = new FormData(form);
  const payload = { name: normalizeName(fields.get('name') || ''), email: String(fields.get('email') || ''), passphrase: String(fields.get('passphrase') || '') };
  state.authDraft = { name: payload.name, email: payload.email };
  state.authBusy = true; state.authError = ''; render();
  try { if (state.authMode === 'signup') await signUp(payload); else await signIn(payload); }
  catch (error) { state.authError = error.message; }
  finally { state.authBusy = false; if (!state.account) render(); }
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, folder, story, url, name, kind, mode } = button.dataset;
  if (action === 'noop') { event.preventDefault(); return; }
  if (action === 'auth-mode') { state.authMode = mode; state.authError = ''; render(); return; }
  if (action === 'sign-out') { endSession(); toast('Signed out. Your library stays on this device.'); return; }
  if (action === 'open-all') { event.preventDefault(); state.activeFolder = 'all'; state.view = 'library'; }
  if (action === 'open-saved') { state.activeFolder = 'saved'; state.view = 'library'; }
  if (action === 'open-discover') { state.view = 'discover'; }
  if (action === 'open-folder') { state.activeFolder = folder; state.view = 'library'; }
  if (action === 'open-reader') { state.selectedStoryId = story; state.view = 'reader'; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (action === 'back-to-library') { state.view = 'library'; state.selectedStoryId = null; }
  if (action === 'increase-font') { state.data.reading.fontScale = Math.min(1.22, Number((state.data.reading.fontScale + 0.06).toFixed(2))); save(); }
  if (action === 'decrease-font') { state.data.reading.fontScale = Math.max(0.88, Number((state.data.reading.fontScale - 0.06).toFixed(2))); save(); }
  if (action === 'toggle-theme') { state.data.reading.theme = state.data.reading.theme === 'night' ? 'paper' : 'night'; save(); }
  if (action === 'toggle-save') { try { const result = toggleSave(story); toast(result.saved ? `Saved “${result.story.title}”.` : 'Removed from Saved.'); } catch (error) { toast(error.message); } }
  if (action === 'toggle-subscribe') { try { const result = toggleSubscription({ name, url, kind }); toast(result.subscribed ? `Subscribed to ${result.subscription.name}.` : `Unsubscribed from ${result.subscription.name}.`); } catch (error) { toast(error.message); } }
  if (action === 'new-folder') { const label = window.prompt('Name this shelf'); if (label) { const created = ensureFolder(label, false); if (created) { state.activeFolder = created.id; state.view = 'library'; save(); toast(`Created ${created.name}.`); } } }
  if (action === 'rename-folder') { const current = state.data.folders.find((entry) => entry.id === folder); const label = current && window.prompt('Rename this shelf', current.name); if (label && current) { current.name = titleFor(label); state.data.feed.filter((entry) => entry.folderId === current.id).forEach((entry) => { entry.folderName = current.name; }); save(); toast('Shelf renamed.'); } }
  render();
});

restoreSession();
render();
registerWebMcpTools();
