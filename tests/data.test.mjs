import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStories, normalizeCreators } from '../src/data.js';

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
