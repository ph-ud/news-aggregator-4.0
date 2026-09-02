import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStories, normalizeCreators, addedByLabel, summaryParagraphs, summaryLength } from '../src/data.js';

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
