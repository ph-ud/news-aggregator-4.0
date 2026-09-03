import { randomId } from './crypto.js';

function asText(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }

/**
 * How much summary we keep. The app never fetches the article, so this text is the whole of
 * what a reader gets before they follow the link — worth a few paragraphs rather than a teaser.
 * The tool schema advertises the same number, so what an assistant is asked for is what survives.
 */
export const SUMMARY_LIMIT = 1200;

/* Prose is trimmed at a word boundary and marked, so a long summary never ends mid-word. */
function asProse(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.search(/\s+\S*$/);
  return `${cut.slice(0, boundary > limit * 0.6 ? boundary : limit).trimEnd()}…`;
}
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }

export function normalizeStories(topic, stories) {
  if (!Array.isArray(stories)) return [];
  const seen = new Set();
  const topicName = asText(topic, 120);
  return stories.slice(0, 10).map((story, index) => {
    const title = asText(story?.title, 240);
    const source = asText(story?.source, 100);
    const url = safeUrl(story?.url);
    if (!title || !source || !url || seen.has(url)) return null;
    seen.add(url);
    const published = new Date(story?.publishedAt);
    const tags = Array.isArray(story?.tags) ? [...new Set(story.tags.map((tag) => asText(tag, 40)).filter(Boolean))].slice(0, 3) : [];
    return { id: randomId(), type: 'story', topic: topicName, addedAt: new Date(Date.now() + index).toISOString(), title, source, url, imageUrl: safeUrl(story?.imageUrl), tags, summary: asProse(story?.summary, SUMMARY_LIMIT) || `Web research about ${topicName}.`, publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(), category: asText(story?.category, 60) || 'Web research', addedBy: 'ChatGPT' };
  }).filter(Boolean);
}

/**
 * Stories an `inject-news-to-feed` replace should drop: only the ones on this same topic's
 * shelf that did not come back in the new batch. A `replace` must never touch another topic's
 * stories — the whole point of `mode: 'replace'` is refreshing one shelf, not the library.
 */
export function staleStoriesForReplace(existingStories, topic, incomingUrls) {
  return existingStories.filter((story) => story.topic === topic && !incomingUrls.has(story.url));
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
    return { id: randomId(), type: 'creator', host: dedupeKey, addedAt: new Date(Date.now() + index).toISOString(), name, url, feedUrl: safeUrl(creator?.feedUrl), handle: asText(creator?.handle, 60), kind: CREATOR_KINDS.includes(kindValue) ? kindValue : 'blog', topics: topics.length ? topics : [asText(topic, 40) || 'Discovery'], cadence: asText(creator?.cadence, 60), description: asProse(creator?.description, 420) || `An independent ${kindValue || 'blog'} covering ${asText(topic, 120) || 'your interests'}.`, whyRelevant: asText(creator?.whyRelevant, 280), discoveredAt: new Date().toISOString(), discoveredFor: asText(topic, 120), addedBy: 'ChatGPT', rank: index };
  }).filter(Boolean);
}

export function creatorKinds() { return [...CREATOR_KINDS]; }

/** Creators a `discover-creators` replace should drop: only this same topic's, never every creator. */
export function staleCreatorsForReplace(existingCreators, topic) {
  const topicName = asText(topic, 120);
  return existingCreators.filter((creator) => creator.discoveredFor === topicName);
}

/**
 * Provenance helpers.
 *
 * Nothing on the shelf was fetched: there is no feed reader and no article scraper here. Every
 * story and creator arrives as structured JSON from an assistant's web research, and the prose
 * we display — summaries, descriptions — is the assistant's, not the publisher's. Views must say
 * so, so the wording lives here where it is pure and testable rather than inline in a template.
 */
export function addedByLabel(record) { return asText(record?.addedBy, 60) || 'an assistant'; }

/** Paragraphs for the reader page. This is the summary we hold, never the article we do not. */
export function summaryParagraphs(story) {
  const summary = asProse(story?.summary, SUMMARY_LIMIT) || `No summary was supplied for this entry from ${asText(story?.source, 100) || 'its source'}.`;
  const paragraphs = summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  return paragraphs.length > 1 ? paragraphs : [summary];
}

/** Length of the summary, so the reader page never advertises a read time for text it lacks. */
export function summaryLength(story) {
  const words = (asProse(story?.summary, SUMMARY_LIMIT).match(/\S+/g) || []).length;
  return words ? `${words} ${words === 1 ? 'word' : 'words'}` : 'No summary';
}
