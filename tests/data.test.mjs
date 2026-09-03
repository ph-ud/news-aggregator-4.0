import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStories, normalizeCreators, staleStoriesForReplace, staleCreatorsForReplace, addedByLabel, summaryParagraphs, summaryLength, SUMMARY_LIMIT } from '../src/data.js';

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
