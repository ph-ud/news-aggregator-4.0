import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStories, normalizeCreators, normalizeFeedItems, normalizeSubscription, staleStoriesForReplace, staleCreatorsForReplace, withoutFeedDuplicates, subscriptionForFeed, originOf, isFromFeed, addedByLabel, provenanceLabel, originBadge, summaryParagraphs, summaryLength, SUMMARY_LIMIT } from '../src/data.js';

test('normalizes agent-supplied news while preserving provenance', () => {
  const stories = normalizeStories('fusion energy', [{ title: 'Fusion update', source: 'Example News', url: 'https://example.com/fusion', publishedAt: '2026-08-26T10:00:00Z', summary: 'A concise update.' }]);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].source, 'Example News');
  assert.equal(stories[0].addedBy, 'ChatGPT');
});

test('rejects invalid URLs and deduplicates by URL', () => {
  const stories = normalizeStories('topic', [{ title: 'Bad', source: 'Source', url: 'javascript:alert(1)' }, { title: 'Good', source: 'Source', url: 'https://example.com/a' }, { title: 'Duplicate', source: 'Source', url: 'https://example.com/a' }]);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].title, 'Good');
});

test('normalizes discovered creators and deduplicates by host', () => {
  const creators = normalizeCreators('urban design', [
    { name: 'Street Notes', url: 'https://streetnotes.example/blog', kind: 'newsletter', cadence: 'Weekly', topics: ['cities', 'transit'], whyRelevant: 'Primary reporting on street redesigns.' },
    { name: 'Street Notes mirror', url: 'https://www.streetnotes.example/feed' },
    { name: 'No URL' },
  ]);
  assert.equal(creators.length, 1);
  assert.equal(creators[0].kind, 'newsletter');
  assert.deepEqual(creators[0].topics, ['cities', 'transit']);
  assert.equal(creators[0].addedBy, 'ChatGPT');
});

test('falls back to a safe kind and rejects unsafe creator URLs', () => {
  const creators = normalizeCreators('design', [
    { name: 'Bad protocol', url: 'javascript:alert(1)' },
    { name: 'Odd kind', url: 'https://example.com/writing', kind: 'telepathy', feedUrl: 'javascript:alert(1)' },
  ]);
  assert.equal(creators.length, 1);
  assert.equal(creators[0].kind, 'blog');
  assert.equal(creators[0].feedUrl, '');
  assert.deepEqual(creators[0].topics, ['design']);
});

test('names the agent that supplied a record, and never leaves it unattributed', () => {
  const [story] = normalizeStories('topic', [{ title: 'T', source: 'S', url: 'https://example.com/a' }]);
  assert.equal(addedByLabel(story), 'ChatGPT');
  /* A record written before provenance was stored still must not read as the publisher's own. */
  assert.equal(addedByLabel({}), 'an assistant');
  assert.equal(addedByLabel(undefined), 'an assistant');
  assert.equal(addedByLabel({ addedBy: '<img src=x>' }), '<img src=x>', 'escaping belongs to the html tag, not here');
});

test('paragraphs the stored summary without inventing article text', () => {
  const long = summaryParagraphs({ summary: 'First sentence. Second sentence.' });
  assert.deepEqual(long, ['First sentence.', 'Second sentence.']);
  assert.deepEqual(summaryParagraphs({ summary: 'Only one' }), ['Only one']);
  /* No summary means we say so, not that we go looking for the article. */
  assert.deepEqual(summaryParagraphs({ source: 'Example News' }), ['No summary was supplied for this entry from Example News.']);
  assert.deepEqual(summaryParagraphs(undefined), ['No summary was supplied for this entry from its source.']);
});

test('measures the summary we hold, not the article we do not', () => {
  assert.equal(summaryLength({ summary: 'Three little words' }), '3 words');
  assert.equal(summaryLength({ summary: 'One' }), '1 word');
  assert.equal(summaryLength({}), 'No summary');
});

test('keeps a summary long enough to be worth reading, and trims it at a word boundary', () => {
  /* The summary is all the reader gets, so a few paragraphs must survive intact. */
  const real = `${'A sentence about the reactor. '.repeat(20)}`.trim();
  assert.ok(real.length > 420, 'the fixture must exceed the old limit to be meaningful');
  const [kept] = normalizeStories('t', [{ title: 'T', source: 'S', url: 'https://example.com/a', summary: real }]);
  assert.equal(kept.summary, real, 'a summary within the limit is stored verbatim');

  const overlong = `${'word '.repeat(400)}tail`;
  const [trimmed] = normalizeStories('t', [{ title: 'T', source: 'S', url: 'https://example.com/b', summary: overlong }]);
  assert.ok(trimmed.summary.length <= SUMMARY_LIMIT + 1, 'the ellipsis is the only character allowed past the limit');
  assert.match(trimmed.summary, /…$/);
  assert.equal(/\bwor…$/.test(trimmed.summary), false, 'a trim must not cut a word in half');
});

test('falls back to a placeholder rather than dropping a story with no summary', () => {
  const [story] = normalizeStories('fusion', [{ title: 'T', source: 'S', url: 'https://example.com/a' }]);
  assert.equal(story.summary, 'Web research about fusion.');
});

test('stamps every story with the topic it was injected under', () => {
  const [story] = normalizeStories('fusion energy', [{ title: 'T', source: 'S', url: 'https://example.com/a' }]);
  assert.equal(story.topic, 'fusion energy');
});

test('a replace only drops stale stories from its own topic, never another topic\'s shelf', () => {
  const existing = [
    { id: 'a', topic: 'fusion', url: 'https://example.com/old-fusion' },
    { id: 'b', topic: 'climate', url: 'https://example.com/old-climate' },
  ];
  const stale = staleStoriesForReplace(existing, 'fusion', new Set(['https://example.com/new-fusion']));
  assert.deepEqual(stale.map((story) => story.id), ['a'], 'a fusion replace must never touch the climate shelf');
});

test('a replace keeps a topic\'s own story when it comes back in the new batch', () => {
  const existing = [{ id: 'a', topic: 'fusion', url: 'https://example.com/kept' }];
  const stale = staleStoriesForReplace(existing, 'fusion', new Set(['https://example.com/kept']));
  assert.deepEqual(stale, []);
});

test('a creator replace only drops creators discovered for that same topic', () => {
  const existing = [
    { id: 'a', discoveredFor: 'urban design' },
    { id: 'b', discoveredFor: 'space telescopes' },
  ];
  const stale = staleCreatorsForReplace(existing, 'urban design');
  assert.deepEqual(stale.map((creator) => creator.id), ['a']);
});

/* ---------- RSS: the origin distinction, and the enforcement behind it ---------- */

const subscription = { id: 'sub-1', type: 'subscription', name: 'Street Notes', host: 'streetnotes.example', url: 'https://streetnotes.example', feedUrl: 'https://streetnotes.example/feed.xml', kind: 'blog' };
const entry = (over = {}) => ({ title: 'Bus lanes', url: 'https://streetnotes.example/bus-lanes', guid: 'sn-1', publishedAt: '2026-09-01T09:00:00Z', summary: 'A post about bus lanes.', ...over });

test('stamps the pipeline that delivered a story, and never takes it from the payload', () => {
  const [researched] = normalizeStories('fusion', [{ title: 'T', source: 'S', url: 'https://example.com/a', summary: 'x' }]);
  assert.equal(researched.via, 'ai');
  const [delivered] = normalizeFeedItems(subscription, [entry()]);
  assert.equal(delivered.via, 'rss');

  /* The claim "a publisher syndicated this" is the whole value of the badge, so a caller must
     not be able to make it. Both normalizers ignore a via they are handed. */
  const [forgedRss] = normalizeStories('fusion', [{ title: 'T', source: 'S', url: 'https://example.com/b', summary: 'x', via: 'rss' }]);
  assert.equal(forgedRss.via, 'ai', 'an AI story cannot label itself as coming from a feed');
  const [forgedAi] = normalizeFeedItems(subscription, [entry({ via: 'ai' })]);
  assert.equal(forgedAi.via, 'rss');
});

test('reads the origin of records stored before the field existed as AI', () => {
  assert.equal(originOf({}), 'ai');
  assert.equal(originOf(undefined), 'ai');
  assert.equal(originOf({ via: 'rss' }), 'rss');
  assert.equal(originOf({ via: 'nonsense' }), 'ai', 'anything unrecognized is not a feed entry');
  assert.equal(isFromFeed({ via: 'rss' }), true);
  assert.equal(isFromFeed({ via: 'ai' }), false);
});

test('files feed entries only under a feed the reader actually subscribed to', () => {
  const subs = [subscription];
  assert.equal(subscriptionForFeed(subs, 'https://streetnotes.example/feed.xml'), subscription);
  /* Tracking parameters and a trailing slash are the same feed. */
  assert.equal(subscriptionForFeed(subs, 'https://www.streetnotes.example/feed.xml/?utm_source=x'), subscription);
  /* A different path on a subscribed host is not the subscribed feed. */
  assert.equal(subscriptionForFeed(subs, 'https://streetnotes.example/other.xml'), null);
  assert.equal(subscriptionForFeed(subs, 'https://elsewhere.example/feed.xml'), null);
  assert.equal(subscriptionForFeed(subs, 'javascript:alert(1)'), null);
  assert.equal(subscriptionForFeed(subs, ''), null);
  assert.equal(subscriptionForFeed([], 'https://streetnotes.example/feed.xml'), null);
  /* A pending subscription has no feed, so nothing may be filed under it. */
  assert.equal(subscriptionForFeed([{ ...subscription, feedUrl: '' }], ''), null);
});

test('attributes a feed entry to the subscription, never to the payload', () => {
  /* Otherwise a delivery could put an entry on the shelf under a masthead the reader trusts. */
  const [story] = normalizeFeedItems(subscription, [entry({ source: 'Reuters', feedUrl: 'https://elsewhere.example/feed' })]);
  assert.equal(story.source, 'Street Notes');
  assert.equal(story.feedUrl, 'https://streetnotes.example/feed.xml');
  assert.equal(story.subscriptionId, 'sub-1');
});

test('rejects feed entries with no title or no valid URL', () => {
  const items = normalizeFeedItems(subscription, [entry({ title: '' }), entry({ url: 'javascript:alert(1)' }), entry({ url: 'https://streetnotes.example/ok' })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://streetnotes.example/ok');
});

test('skips entries already on the shelf, because a feed re-lists everything every fetch', () => {
  const existing = [{ via: 'rss', guid: 'sn-1', url: 'https://streetnotes.example/bus-lanes' }];
  assert.equal(normalizeFeedItems(subscription, [entry()], existing).length, 0, 'same guid');
  /* A feed that changed an entry's guid but not its link is still the same post. */
  assert.equal(normalizeFeedItems(subscription, [entry({ guid: 'changed' })], existing).length, 0, 'same url');
  assert.equal(normalizeFeedItems(subscription, [entry({ guid: 'sn-2', url: 'https://streetnotes.example/new' })], existing).length, 1);
  /* And twice within one batch is once. */
  assert.equal(normalizeFeedItems(subscription, [entry(), entry()]).length, 1);
});

test('a feed entry with no description says so rather than borrowing a summary', () => {
  const [story] = normalizeFeedItems(subscription, [entry({ summary: '' })]);
  assert.equal(story.summary, 'Street Notes published this entry without a description in their feed.');
  assert.equal(story.addedBy, '', 'a feed entry was not added by an assistant');
});

test('a subscription with no feed delivers nothing', () => {
  assert.deepEqual(normalizeFeedItems({ ...subscription, feedUrl: '' }, [entry()]), []);
  assert.deepEqual(normalizeFeedItems(null, [entry()]), []);
  assert.deepEqual(normalizeFeedItems(subscription, null), []);
});

test('describes a feed entry as the publisher\'s, and an AI story as an assistant\'s', () => {
  const [feedStory] = normalizeFeedItems(subscription, [entry()]);
  const [aiStory] = normalizeStories('fusion', [{ title: 'T', source: 'Example News', url: 'https://example.com/a', summary: 'x' }]);
  /* Crediting an assistant for a publisher's own syndicated post is the same class of error
     as passing a model's summary off as the article. */
  assert.equal(provenanceLabel(feedStory), "From Street Notes's feed");
  assert.equal(provenanceLabel(aiStory), 'Added by ChatGPT');
  assert.equal(originBadge(feedStory), 'RSS');
  assert.equal(originBadge(aiStory), 'AI');
  assert.equal(provenanceLabel({}), 'Added by an assistant');
});

test('an AI replace never clears a subscription\'s entries', () => {
  /* A feed's stories carry the subscription's name as their topic, so a topic that happens to
     share that name would otherwise let one refresh wipe a shelf the reader subscribed to. */
  const existing = [
    { id: 'ai-1', via: 'ai', topic: 'Street Notes', url: 'https://example.com/old' },
    { id: 'rss-1', via: 'rss', topic: 'Street Notes', url: 'https://streetnotes.example/old' },
  ];
  const stale = staleStoriesForReplace(existing, 'Street Notes', new Set());
  assert.deepEqual(stale.map((story) => story.id), ['ai-1']);
});

test('drops an AI story a subscription already delivered, keeping one card per link', () => {
  const shelf = [{ via: 'rss', url: 'https://streetnotes.example/bus-lanes' }];
  const supplied = normalizeStories('streets', [
    { title: 'Bus lanes', source: 'Street Notes', url: 'https://streetnotes.example/bus-lanes', summary: 'x' },
    { title: 'Other', source: 'Elsewhere', url: 'https://elsewhere.example/a', summary: 'x' },
  ]);
  const kept = withoutFeedDuplicates(supplied, shelf);
  assert.deepEqual(kept.map((story) => story.url), ['https://elsewhere.example/a']);
  /* An AI story already on the shelf as an AI story is a different question, left to replace. */
  assert.equal(withoutFeedDuplicates(supplied, [{ via: 'ai', url: 'https://streetnotes.example/bus-lanes' }]).length, 2);
});

test('keeps a subscription made before its feed URL is known, and marks it pending', () => {
  const pending = normalizeSubscription({ name: 'Street Notes', url: 'https://streetnotes.example/some/article' });
  assert.equal(pending.host, 'streetnotes.example');
  assert.equal(pending.feedUrl, '');
  assert.equal(pending.feedStatus, 'pending', 'the reader has chosen who to follow; the feed can come later');

  const active = normalizeSubscription({ name: 'Street Notes', url: 'https://streetnotes.example', feedUrl: 'https://streetnotes.example/feed.xml' });
  assert.equal(active.feedStatus, 'active');
  /* An unsafe feed URL is dropped, not stored: it would be handed to a fetcher. */
  assert.equal(normalizeSubscription({ name: 'X', url: 'https://x.example', feedUrl: 'javascript:alert(1)' }).feedStatus, 'pending');
  assert.equal(normalizeSubscription({ name: 'X', url: 'javascript:alert(1)' }), null);
  assert.equal(normalizeSubscription({ name: 'X', url: 'https://x.example', kind: 'telepathy' }).kind, 'blog');
});
