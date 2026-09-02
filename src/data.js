import { randomId } from './crypto.js';

function asText(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }

export function normalizeStories(topic, stories) {
  if (!Array.isArray(stories)) return [];
  const seen = new Set();
  return stories.slice(0, 10).map((story, index) => {
    const title = asText(story?.title, 240);
    const source = asText(story?.source, 100);
    const url = safeUrl(story?.url);
    if (!title || !source || !url || seen.has(url)) return null;
    seen.add(url);
    const published = new Date(story?.publishedAt);
    const tags = Array.isArray(story?.tags) ? [...new Set(story.tags.map((tag) => asText(tag, 40)).filter(Boolean))].slice(0, 3) : [];
    return { id: randomId(), type: 'story', addedAt: new Date(Date.now() + index).toISOString(), title, source, url, imageUrl: safeUrl(story?.imageUrl), tags, summary: asText(story?.summary, 420) || `Web research about ${asText(topic, 120)}.`, publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(), category: asText(story?.category, 60) || 'Web research', addedBy: 'ChatGPT' };
  }).filter(Boolean);
}

const CREATOR_KINDS = ['blog', 'newsletter', 'podcast', 'video', 'magazine', 'independent'];

export function normalizeCreators(topic, creators) {
  if (!Array.isArray(creators)) return [];
  const seen = new Set();
  return creators.slice(0, 12).map((creator, index) => {
    const name = asText(creator?.name, 120);
    const url = safeUrl(creator?.url);
    if (!name || !url) return null;
    const dedupeKey = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
    if (seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);
    const kindValue = asText(creator?.kind, 20).toLocaleLowerCase();
    const topics = Array.isArray(creator?.topics) ? [...new Set(creator.topics.map((entry) => asText(entry, 40)).filter(Boolean))].slice(0, 4) : [];
    return { id: randomId(), type: 'creator', host: dedupeKey, addedAt: new Date(Date.now() + index).toISOString(), name, url, feedUrl: safeUrl(creator?.feedUrl), handle: asText(creator?.handle, 60), kind: CREATOR_KINDS.includes(kindValue) ? kindValue : 'blog', topics: topics.length ? topics : [asText(topic, 40) || 'Discovery'], cadence: asText(creator?.cadence, 60), description: asText(creator?.description, 420) || `An independent ${kindValue || 'blog'} covering ${asText(topic, 120) || 'your interests'}.`, whyRelevant: asText(creator?.whyRelevant, 280), discoveredAt: new Date().toISOString(), discoveredFor: asText(topic, 120), addedBy: 'ChatGPT', rank: index };
  }).filter(Boolean);
}

export function creatorKinds() { return [...CREATOR_KINDS]; }
