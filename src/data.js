import { randomId } from './crypto.js';

function asText(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }

/**
 * How much summary we keep. The app never fetches the article, so this text is the whole of
 * what a reader gets before they follow the link — worth a few paragraphs rather than a teaser.
 * The tool schema advertises the same number, so what an assistant is asked for is what survives.
 */
export const SUMMARY_LIMIT = 1200;

/**
 * Where a post came from, and the reason it is a field rather than a guess.
 *
 * Two pipelines now write stories. A subscription delivers entries a publisher wrote and
 * syndicated; the AI tools deliver entries an assistant researched and summarized. The text
 * on the card means something different in each case — one is the publisher's own words, the
 * other is a model's — so a reader who cannot tell them apart is being misled about who
 * wrote what they are reading.
 *
 * `via` is therefore stamped here, from which normalizer ran, and is never read off the
 * record an agent supplied. `normalizeStories` hard-codes `ai` and `normalizeFeedItems`
 * hard-codes `rss`; neither tool schema exposes the field, and both schemas set
 * `additionalProperties: false` so it cannot be smuggled in alongside the real ones. A
 * caller that could set its own `via` could label an invented story as syndicated reporting,
 * which is precisely the claim the badge exists to make trustworthy.
 */
export const VIA_RSS = 'rss';
export const VIA_AI = 'ai';

/** The origin of a record, defaulting to `ai` for stories stored before the field existed. */
export function originOf(record) { return record?.via === VIA_RSS ? VIA_RSS : VIA_AI; }
export function isFromFeed(record) { return originOf(record) === VIA_RSS; }

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
    return { id: randomId(), type: 'story', topic: topicName, addedAt: new Date(Date.now() + index).toISOString(), title, source, url, imageUrl: safeUrl(story?.imageUrl), tags, summary: asProse(story?.summary, SUMMARY_LIMIT) || `Web research about ${topicName}.`, publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(), category: asText(story?.category, 60) || 'Web research', addedBy: 'ChatGPT', via: VIA_AI };
  }).filter(Boolean);
}

/**
 * Stories newest first by when they were *published*, not when they landed here.
 *
 * Home mixes both pipelines, and arrival order would clump it: a fetch drops a subscription's
 * whole backlog in at once, an injection drops a topic's whole batch in at once, so the shelf
 * would read as blocks of one origin after blocks of the other rather than as one timeline. A
 * publication date is also the only date the two pipelines share a meaning for — a feed entry
 * fetched today may be a week old, and it should sit where a week-old story belongs.
 *
 * `addedAt` breaks the tie, so entries a feed published without a date keep a stable order
 * instead of shuffling on every render.
 */
function timeOf(value) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.getTime(); }
export function sortStoriesByDate(stories) {
  return [...(stories || [])].sort((a, b) => {
    const published = (timeOf(b?.publishedAt) ?? -Infinity) - (timeOf(a?.publishedAt) ?? -Infinity);
    return published || String(b?.addedAt || '').localeCompare(String(a?.addedAt || ''));
  });
}

/**
 * A feed's identity, used to match a delivery against a subscription. Comparing whole URLs
 * would let `?utm_source=` or a missing trailing slash look like a different feed; comparing
 * only the host would let any page on a subscribed domain deliver as that subscription.
 */
export function feedIdentity(value) {
  const url = safeUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * The subscription a batch of feed items is allowed to be filed under, or null.
 *
 * This is the enforcement the origin badge rests on. An item is stored as `rss` — a claim
 * that a publisher syndicated it — only when it arrives under a feed the reader themselves
 * subscribed to. Nothing else earns that label: an assistant that fetched a feed nobody
 * subscribed to, or that simply says it did, gets a refusal rather than a relabelling to
 * `ai`, because silently rewriting the origin would turn a rejected claim into an accepted
 * one under a different name.
 */
export function subscriptionForFeed(subscriptions, feedUrl) {
  const identity = feedIdentity(feedUrl);
  if (!identity) return null;
  return (Array.isArray(subscriptions) ? subscriptions : []).find((entry) => feedIdentity(entry?.feedUrl) === identity) || null;
}

/**
 * Entries from one subscribed feed, normalized into stories.
 *
 * The trust model differs from `normalizeStories` in one way that matters: `source` and
 * `feedUrl` are taken from the *subscription*, never from the payload, so a delivery cannot
 * attribute an entry to a publication the reader did not subscribe to. Everything else in
 * the payload is still untrusted text and goes through the same trimming and URL validation.
 *
 * Deduplication is by guid where the feed supplies one and by URL otherwise, against both
 * the batch and what is already on the shelf, because a feed re-lists the same entry on
 * every fetch — that is what a feed is.
 */
export function normalizeFeedItems(subscription, items, existingStories = []) {
  if (!subscription || !Array.isArray(items)) return [];
  const feedUrl = safeUrl(subscription.feedUrl);
  if (!feedUrl) return [];
  const source = asText(subscription.name, 100) || asText(subscription.host, 100) || 'Subscription';
  const known = new Set();
  for (const story of existingStories) {
    if (story?.guid) known.add(`g:${story.guid}`);
    if (story?.url) known.add(`u:${story.url}`);
  }
  return items.slice(0, 50).map((item, index) => {
    const title = asText(item?.title, 240);
    const url = safeUrl(item?.url);
    if (!title || !url) return null;
    const guid = asText(item?.guid, 200);
    const keys = [guid ? `g:${guid}` : `u:${url}`, `u:${url}`];
    if (keys.some((key) => known.has(key))) return null;
    keys.forEach((key) => known.add(key));
    const published = new Date(item?.publishedAt);
    return {
      id: randomId(), type: 'story', via: VIA_RSS,
      topic: asText(subscription.name, 120) || source,
      addedAt: new Date(Date.now() + index).toISOString(),
      title, source, url, guid, feedUrl,
      subscriptionId: asText(subscription.id, 80),
      imageUrl: safeUrl(item?.imageUrl),
      tags: [],
      summary: asProse(item?.summary, SUMMARY_LIMIT) || `${source} published this entry without a description in their feed.`,
      publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(),
      category: asText(subscription.kind, 60) || 'Subscription',
      /* Not "added by" anyone: a feed entry is the publisher's, delivered as they wrote it. */
      addedBy: '', author: asText(item?.author, 120),
    };
  }).filter(Boolean);
}

/**
 * Stories an `inject-news-to-feed` replace should drop: only the ones on this same topic's
 * shelf that did not come back in the new batch. A `replace` must never touch another topic's
 * stories — the whole point of `mode: 'replace'` is refreshing one shelf, not the library.
 *
 * It must never touch a subscription's entries either. Those did not come from the tool doing
 * the replacing, and a feed's stories carry the subscription's name as their topic, so a
 * topic that happens to share a name with a subscription would otherwise let one AI refresh
 * silently clear a shelf the reader had subscribed to.
 */
export function staleStoriesForReplace(existingStories, topic, incomingUrls) {
  return existingStories.filter((story) => originOf(story) === VIA_AI && story.topic === topic && !incomingUrls.has(story.url));
}

/**
 * Incoming AI stories minus the ones a subscription already delivered.
 *
 * When both pipelines carry the same article, the feed's copy is the publisher's own entry
 * and the AI's is a summary of it. Keeping both would shelve the same link twice with two
 * different provenance badges, which reads as a bug and undermines the badge everywhere else.
 */
export function withoutFeedDuplicates(stories, existingStories) {
  const fromFeeds = new Set((existingStories || []).filter(isFromFeed).map((story) => story.url));
  return stories.filter((story) => !fromFeeds.has(story.url));
}

/**
 * The kinds a subscription can be. A reader following a podcast and a reader following a
 * newsletter want the same thing from this app — entries in a list — so the kind is a label
 * on the card, never a branch in the code.
 */
const SOURCE_KINDS = ['blog', 'newsletter', 'podcast', 'video', 'magazine', 'independent'];

export function sourceKinds() { return [...SOURCE_KINDS]; }

/**
 * A subscription record.
 *
 * `feedUrl` is what makes a subscription deliver anything, and it is often not known at the
 * moment the reader presses Subscribe — a story card knows the article's host and nothing
 * else. A subscription with no feed is kept as `pending` rather than refused: the reader has
 * said who they want to follow, which is the part only they can decide, and an assistant can
 * supply the feed URL afterwards. Pending simply means nothing arrives yet.
 */
export function normalizeSubscription({ name, url, host, kind = 'blog', description = '', feedUrl = '' } = {}) {
  const safeSite = safeUrl(url);
  const siteHost = host || (() => { try { return new URL(safeSite).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  if (!siteHost) return null;
  const kindValue = asText(kind, 20).toLocaleLowerCase();
  const feed = safeUrl(feedUrl);
  return {
    type: 'subscription', host: siteHost,
    name: asText(name, 60) || siteHost,
    url: safeSite, feedUrl: feed,
    feedStatus: feed ? 'active' : 'pending',
    kind: SOURCE_KINDS.includes(kindValue) ? kindValue : 'blog',
    description: asProse(description, 420),
    addedAt: new Date().toISOString(), lastFetchedAt: '', itemCount: 0,
  };
}

/**
 * Notes.
 *
 * A note is the only text in this library the reader wrote themselves. Everything else is a
 * publisher's or a model's, which is why the provenance rules exist; a note needs no such
 * hedging, and it is the one record whose loss cannot be repaired by fetching anything again.
 */
export const NOTE_LIMIT = 4000;

/** Trimmed and capped. An empty note is not a note — the caller deletes the record instead. */
export function normalizeNote(text) { return typeof text === 'string' ? text.trim().slice(0, NOTE_LIMIT) : ''; }

/**
 * Every note beside the article it belongs to, newest first.
 *
 * A note can outlive its story: `inject-news-to-feed` with `mode: 'replace'` drops stories the
 * new batch did not carry, and a reader who annotated one of them still wrote that sentence.
 * Deleting their words as a side effect of refreshing a shelf would be indefensible, so the
 * pairing keeps the orphan and reports what it knows — the note itself, and whatever the note
 * recorded about the article when it was written.
 */
export function notesWithArticles(notes, stories) {
  const byId = new Map((stories || []).map((story) => [story.id, story]));
  return (notes || [])
    .filter((note) => normalizeNote(note?.text))
    .map((note) => {
      const story = byId.get(note.storyId) || null;
      return {
        note, story,
        orphaned: !story,
        title: story?.title || note.storyTitle || 'A story no longer on the shelf',
        source: story?.source || note.storySource || '',
        url: story?.url || note.storyUrl || '',
      };
    })
    .sort((a, b) => String(b.note.updatedAt || b.note.addedAt || '').localeCompare(String(a.note.updatedAt || a.note.addedAt || '')));
}

/**
 * Provenance helpers.
 *
 * An AI story is never fetched: it arrives as structured JSON from an assistant's web research,
 * and the prose we display is the assistant's, not the publisher's. A feed entry is the
 * publisher's own syndicated text. Views must say which, so the wording lives here where it is
 * pure and testable rather than inline in a template.
 */
export function addedByLabel(record) { return asText(record?.addedBy, 60) || 'an assistant'; }

/**
 * The provenance line for a card, which is not the same sentence for both pipelines.
 *
 * An AI story's prose is a model's summary of reporting the app never fetched. A feed entry's
 * prose is what the publisher themselves syndicated. Saying "added by an assistant" over a
 * publisher's own words would be as wrong as letting a model's summary pass as the article,
 * so the wording is derived from `via` rather than written into each view.
 */
export function provenanceLabel(record) {
  return isFromFeed(record)
    ? `From ${asText(record?.source, 100) || 'a subscription'}'s feed`
    : `Added by ${addedByLabel(record)}`;
}

/** Short badge text. The reader scans this; `provenanceLabel` is the full sentence. */
export function originBadge(record) { return isFromFeed(record) ? 'RSS' : 'AI'; }

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
