import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStories, normalizeFeedItems, normalizeSubscription, normalizeNote, notesWithArticles, NOTE_LIMIT, isUnread, unreadCount, sortStoriesByDate, staleStoriesForReplace, withoutFeedDuplicates, subscriptionForFeed, originOf, isFromFeed, addedByLabel, provenanceLabel, originBadge, summaryParagraphs, summaryLength, SUMMARY_LIMIT } from '../src/data.js';

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

test('orders a mixed shelf by publication date, so Home reads as one timeline', () => {
  /* Arrival order would clump Home: a fetch drops a backlog in at once and an injection drops
     a batch in at once, so the two pipelines would sit in blocks rather than interleaved. */
  const shelf = [
    { id: 'ai-old', via: 'ai', publishedAt: '2026-08-20T00:00:00Z', addedAt: '2026-09-03T10:00:00Z' },
    { id: 'rss-new', via: 'rss', publishedAt: '2026-09-02T00:00:00Z', addedAt: '2026-09-03T09:00:00Z' },
    { id: 'ai-new', via: 'ai', publishedAt: '2026-09-01T00:00:00Z', addedAt: '2026-09-03T10:00:00Z' },
  ];
  assert.deepEqual(sortStoriesByDate(shelf).map((story) => story.id), ['rss-new', 'ai-new', 'ai-old']);
  /* Sorting must not mutate the library it was handed. */
  assert.equal(shelf[0].id, 'ai-old');
});

test('a story with no usable date sorts last, in a stable order', () => {
  const shelf = [
    { id: 'undated-early', addedAt: '2026-09-01T00:00:00Z' },
    { id: 'dated', publishedAt: '2026-08-01T00:00:00Z', addedAt: '2026-09-03T00:00:00Z' },
    { id: 'undated-late', publishedAt: 'not a date', addedAt: '2026-09-02T00:00:00Z' },
  ];
  const order = sortStoriesByDate(shelf).map((story) => story.id);
  assert.equal(order[0], 'dated', 'anything with a real date outranks one without');
  assert.deepEqual(order.slice(1), ['undated-late', 'undated-early'], 'undated entries fall back to arrival order');
  assert.deepEqual(sortStoriesByDate(undefined), []);
});

test('the Subscriptions tab can only ever hold feed entries', () => {
  /* The tab is the reader's own subscriptions. An assistant researching a topic while they are
     looking at it must not slip a model's summary in among posts from people they follow. */
  const shelf = [
    { id: 'rss-1', via: 'rss', publishedAt: '2026-09-02T00:00:00Z' },
    { id: 'ai-1', via: 'ai', publishedAt: '2026-09-03T00:00:00Z' },
    { id: 'legacy', publishedAt: '2026-09-04T00:00:00Z' },
  ];
  assert.deepEqual(sortStoriesByDate(shelf.filter(isFromFeed)).map((s) => s.id), ['rss-1']);
  /* And AI finds is its complement, so nothing can fall between the two tabs. */
  assert.deepEqual(sortStoriesByDate(shelf.filter((s) => !isFromFeed(s))).map((s) => s.id), ['legacy', 'ai-1']);
  assert.equal(shelf.filter(isFromFeed).length + shelf.filter((s) => !isFromFeed(s)).length, shelf.length);
});

/* ---------- notes ---------- */

test('trims and caps a note, and treats an empty one as no note', () => {
  assert.equal(normalizeNote('  a thought  '), 'a thought');
  assert.equal(normalizeNote('   '), '', 'whitespace is not a note; the caller deletes the record');
  assert.equal(normalizeNote(undefined), '');
  assert.equal(normalizeNote(42), '');
  assert.equal(normalizeNote('x'.repeat(NOTE_LIMIT + 500)).length, NOTE_LIMIT);
});

test('pairs every note with the article it was written on, newest first', () => {
  const stories = [{ id: 's1', title: 'Bus lanes', source: 'Street Notes', url: 'https://streetnotes.example/bus' }];
  const notes = [
    { id: 'n1', storyId: 's1', text: 'The counts are the whole argument.', updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'n2', storyId: 's1', text: 'Later thought.', updatedAt: '2026-09-03T00:00:00Z' },
  ];
  const paired = notesWithArticles(notes, stories);
  assert.deepEqual(paired.map((entry) => entry.note.id), ['n2', 'n1']);
  assert.equal(paired[0].title, 'Bus lanes');
  assert.equal(paired[0].orphaned, false);
});

test('keeps a note whose story a replace dropped, using what the note recorded', () => {
  /* Deleting the reader's own words as a side effect of refreshing a shelf is indefensible;
     a surviving note that cannot say what it was about is barely a note either. */
  const notes = [{ id: 'n1', storyId: 'gone', text: 'Worth revisiting.', storyTitle: 'Reactor milestone', storySource: 'Example News', storyUrl: 'https://example.com/a', updatedAt: '2026-09-02T00:00:00Z' }];
  const [entry] = notesWithArticles(notes, []);
  assert.equal(entry.orphaned, true);
  assert.equal(entry.title, 'Reactor milestone');
  assert.equal(entry.source, 'Example News');
  assert.equal(entry.url, 'https://example.com/a');
  assert.equal(entry.story, null);
});

test('an orphan with nothing recorded still says what it is, and blank notes are dropped', () => {
  const [entry] = notesWithArticles([{ id: 'n1', storyId: 'gone', text: 'A thought.' }], []);
  assert.equal(entry.title, 'A story no longer on the shelf');
  assert.deepEqual(notesWithArticles([{ id: 'n2', storyId: 's1', text: '   ' }], []), []);
  assert.deepEqual(notesWithArticles(undefined, undefined), []);
});

/* ---------- read state ---------- */

test('a story is unread until it has been opened', () => {
  assert.equal(isUnread({ id: 'a' }), true);
  assert.equal(isUnread({ id: 'a', readAt: '' }), true, 'an empty stamp is not a read');
  assert.equal(isUnread({ id: 'a', readAt: '2026-09-03T00:00:00Z' }), false);
  assert.equal(isUnread(undefined), true);
});

test('counts are unread counts, because a total is what the shelf already shows', () => {
  const shelf = [
    { id: 'a' },
    { id: 'b', readAt: '2026-09-01T00:00:00Z' },
    { id: 'c' },
    { id: 'd', readAt: '2026-09-02T00:00:00Z' },
  ];
  assert.equal(unreadCount(shelf), 2);
  assert.equal(unreadCount(shelf.filter((story) => story.readAt)), 0, 'nothing unread means no badge at all');
  assert.equal(unreadCount([]), 0);
  assert.equal(unreadCount(undefined), 0);
});

test('read state rides on the story, so a dropped story strands no marker', () => {
  /* A separate record would outlive the story a replace removed and count toward a badge for
     something no longer on any shelf. */
  const [story] = normalizeStories('fusion', [{ title: 'T', source: 'S', url: 'https://example.com/a', summary: 'x' }]);
  assert.equal('readAt' in story, false, 'a fresh story carries no stamp');
  assert.equal(isUnread(story), true);
  assert.equal(isUnread({ ...story, readAt: new Date().toISOString() }), false);
});
