import { normalizeStories } from './src/data.js';

const STORAGE_KEY = 'signal-news-feed-v2';
const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
const state = { feed: loadFeed(), activeCategory: 'For you', webmcp: { supported: false, registered: 0 } };
let toolsRegistered = false;

function loadFeed() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

function saveFeed() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.feed)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Just now' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date); }
function formatToday() { return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()); }

function icon(name) {
  const icons = {
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.7 3.9-3.9 1.7 1.7-3.9 3.9-1.7Z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2.8 14.1 10l7.1 2-7.1 2.1-2.1 7.1-2-7.1-7.2-2.1 7.2-2L12 2.8Z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M3.8 12h16.4M12 3.5c2 2.3 3 5.1 3 8.5s-1 6.2-3 8.5c-2-2.3-3-5.1-3-8.5s1-6.2 3-8.5Z"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19.9 4.1C12.2 4.3 6.3 6.3 5 11.4c-.7 2.9 1.7 4.8 4.2 4.1 5-1.4 7-7.3 7.1-7.3"/><path d="M4.1 20c2.4-4 5.4-6.3 9.6-8.4"/></svg>',
    business: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M4 12h16M10 12v2h4v-2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12 4.5 4.5L19 7"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  };
  return icons[name] || '';
}

function visibleFeed() { return state.activeCategory === 'For you' ? state.feed : state.feed.filter((story) => story.category === state.activeCategory); }
function navItems() { return [['For you', 'compass'], ['Tech & AI', 'spark'], ['World', 'globe'], ['Climate', 'leaf'], ['Business', 'business']]; }
function storyMeta(story) { return `<div class="story-meta"><span class="source-badge">${escapeHtml(story.source)}</span><span>·</span><span>${formatDate(story.publishedAt)}</span></div>`; }
function storyCard(story) { return `<article class="story-card agent-added"><div><div class="agent-tag">Added by ChatGPT</div><h3>${escapeHtml(story.title)}</h3><p>${escapeHtml(story.summary)}</p></div><div class="story-footer">${storyMeta(story)}<a class="story-action" href="${escapeHtml(safeUrl(story.url))}" target="_blank" rel="noreferrer">Read ${icon('arrow')}</a></div></article>`; }

function emptyFeed() {
  return `<section class="empty-feed"><span class="empty-orbit" aria-hidden="true">${icon('spark')}</span><p class="eyebrow">Waiting for a question</p><h2>Ask ChatGPT what’s happening.</h2><p>Signal stays deliberately empty until your agent searches the web and brings back reporting worth keeping.</p><div class="prompt-quote">“What changed in fusion energy this week?”</div></section>`;
}

function render() {
  const feed = visibleFeed();
  const [lead, ...rest] = feed;
  const status = state.webmcp.supported ? `${state.webmcp.registered} tools ready` : 'Opening agent bridge';
  app.innerHTML = `<div class="shell">
    <aside class="rail"><div class="brand"><span class="brand-mark">${icon('spark')}</span>signal</div><nav class="nav" aria-label="Sections">${navItems().map(([name, navIcon]) => `<button class="${state.activeCategory === name ? 'active' : ''}" data-action="category" data-category="${name}">${icon(navIcon)}<span>${name}</span></button>`).join('')}</nav><div class="rail-footer"><p class="eyebrow">Your edition</p><div class="profile"><span class="avatar">Y</span><div><strong>You</strong><small>Curious by default</small></div></div></div></aside>
    <main class="main"><div class="topline"><span class="date">${formatToday()}</span><span class="live-pill"><i class="live-dot"></i> ${status}</span></div><header class="hero"><p class="eyebrow">A calmer news feed</p><h1>A blank page for the <em>right questions.</em></h1><p class="hero-copy">Ask ChatGPT about a subject. It searches the web, weighs the sources, then places the useful reporting here — with provenance intact.</p></header><div class="section-heading"><h2>${state.activeCategory === 'For you' ? 'Your briefing' : state.activeCategory}</h2><span>${feed.length ? `${feed.length} ${feed.length === 1 ? 'story' : 'stories'}` : 'No stories yet'}</span></div>${lead ? `<article class="lead-card"><div class="lead-content"><div class="lead-label"><span></span>Fresh briefing · ${escapeHtml(lead.category)}</div><div class="agent-tag">Added by ChatGPT</div><h3>${escapeHtml(lead.title)}</h3><p>${escapeHtml(lead.summary)}</p>${storyMeta(lead)}</div><div class="lead-art" aria-hidden="true"></div></article><div class="story-grid">${rest.slice(0, 8).map(storyCard).join('')}</div>` : emptyFeed()}</main>
    <aside class="right-rail"><section class="side-card agent-card"><div class="agent-status"><div><strong>Agent bridge</strong><small>WebMCP is ${state.webmcp.supported ? 'connected' : 'loading'}</small></div><span class="status-check">${icon('check')}</span></div><p>This page does not fetch news. ChatGPT does the research, then uses a page tool to add sourced results.</p><div class="agent-steps"><div class="step"><b>1</b><span>You ask about a subject.</span></div><div class="step"><b>2</b><span>ChatGPT searches the web.</span></div><div class="step"><b>3</b><span>Signal receives the briefing.</span></div></div></section><section class="side-card"><h3>Try a question</h3><div class="topic-list"><span class="topic">AI regulation</span><span class="topic">Fusion energy</span><span class="topic">Climate tech</span><span class="topic">Local elections</span></div></section><section class="side-card"><h3>Feed pulse</h3><div class="mini-stat"><span>Stories in view</span><strong>${feed.length}</strong></div><div class="mini-stat"><span>Web-researched</span><strong>${state.feed.length}</strong></div><div class="mini-stat"><span>Sources</span><strong>${new Set(state.feed.map((story) => story.source)).size}</strong></div></section></aside>
  </div>`;
}

function showToast(message) { const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message; toastRegion.append(toast); setTimeout(() => toast.remove(), 3300); }

function injectNews(topic, stories, mode = 'replace') {
  const normalized = normalizeStories(topic, stories);
  if (!normalized.length) throw new Error('No valid stories were supplied. Each story needs a title, source, and https URL.');
  state.feed = mode === 'append' ? [...normalized, ...state.feed.filter((story) => !normalized.some((entry) => entry.url === story.url))] : normalized;
  saveFeed();
  render();
  showToast(`${normalized.length} ${normalized.length === 1 ? 'story' : 'stories'} added from web research.`);
  return { topic, mode, added: normalized, feedCount: state.feed.length };
}

async function registerWebMcpTools() {
  if (!document.modelContext?.registerTool || toolsRegistered) return;
  toolsRegistered = true;
  const injectTool = {
    name: 'inject-news-to-feed', title: 'Inject web-researched news into Signal',
    description: 'Place web-researched articles into the visible Signal feed. The caller must search the web first and supply only selected article records. With mode replace, the current local feed is replaced; append adds new URLs. This tool does not fetch, open, or transmit links.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'The user’s requested subject.' }, mode: { type: 'string', enum: ['replace', 'append'], description: 'Replace the current feed or append new stories.' }, stories: { type: 'array', minItems: 1, maxItems: 10, description: 'Selected web-search results.', items: { type: 'object', properties: { title: { type: 'string' }, source: { type: 'string' }, url: { type: 'string' }, publishedAt: { type: 'string' }, summary: { type: 'string' }, category: { type: 'string' } }, required: ['title', 'source', 'url'], additionalProperties: false } } }, required: ['topic', 'stories'], additionalProperties: false },
    annotations: { untrustedContentHint: true }, execute: async ({ topic, stories, mode = 'replace' }) => injectNews(topic, stories, mode),
  };
  const feedTool = { name: 'get-current-feed', title: 'Read the current Signal feed', description: 'Read the visible Signal article records to avoid duplicates. This is read-only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => ({ stories: state.feed, count: state.feed.length }) };
  try { await document.modelContext.registerTool(injectTool); await document.modelContext.registerTool(feedTool); state.webmcp = { supported: true, registered: 2 }; render(); } catch (error) { toolsRegistered = false; console.warn('WebMCP registration unavailable:', error); }
}

document.addEventListener('click', (event) => { const target = event.target.closest('[data-action="category"]'); if (!target) return; state.activeCategory = target.dataset.category; render(); });
render();
registerWebMcpTools();
