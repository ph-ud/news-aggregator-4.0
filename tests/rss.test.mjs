import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseFeedMeta, stripMarkup, decodeEntities, looksLikeFeed } from '../src/rss.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Street Notes</title>
    <link>https://streetnotes.example</link>
    <description>Notes on streets</description>
    <item>
      <title><![CDATA[Bus lanes & the <b>grid</b>]]></title>
      <link>https://streetnotes.example/bus-lanes</link>
      <guid isPermaLink="false">sn-0001</guid>
      <pubDate>Mon, 01 Sep 2026 09:00:00 GMT</pubDate>
      <description>&lt;p&gt;A post about &amp;quot;bus lanes&amp;quot;.&lt;/p&gt;</description>
      <dc:creator>Ada Reyes</dc:creator>
    </item>
    <item>
      <title>Second entry</title>
      <link>https://streetnotes.example/second</link>
      <description>Short one.</description>
      <content:encoded><![CDATA[<p>The <em>full</em> post body.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Sky Log</title>
  <link rel="self" href="https://sky.example/feed.xml"/>
  <link rel="alternate" href="https://sky.example"/>
  <entry>
    <title>Comet returns</title>
    <link rel="self" href="https://sky.example/feed.xml"/>
    <link rel="alternate" href="https://sky.example/comet"/>
    <id>tag:sky.example,2026:comet</id>
    <updated>2026-09-02T10:00:00Z</updated>
    <summary type="html">A &lt;em&gt;bright&lt;/em&gt; one.</summary>
  </entry>
</feed>`;

test('parses an RSS 2.0 channel and its items', () => {
  const { feed, items } = parseFeed(RSS);
  assert.equal(feed.title, 'Street Notes');
  assert.equal(feed.link, 'https://streetnotes.example');
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://streetnotes.example/bus-lanes');
  assert.equal(items[0].guid, 'sn-0001');
  assert.equal(items[0].author, 'Ada Reyes');
});

test('parses an Atom feed, taking the alternate link rather than the feed itself', () => {
  const { feed, items } = parseFeed(ATOM);
  assert.equal(feed.title, 'Sky Log');
  /* rel="self" points back at the feed; using it would link every entry to the feed document. */
  assert.equal(items[0].url, 'https://sky.example/comet');
  assert.equal(items[0].guid, 'tag:sky.example,2026:comet');
  assert.equal(items[0].publishedAt, '2026-09-02T10:00:00Z');
});

test('the channel title never leaks into an item, or vice versa', () => {
  const meta = parseFeedMeta(RSS);
  assert.equal(meta.title, 'Street Notes', 'entries are removed before the channel is read');
  const [first] = parseFeed(RSS).items;
  assert.notEqual(first.title, 'Street Notes');
});

test('prefers the full post body over the short description when a feed carries both', () => {
  const [, second] = parseFeed(RSS).items;
  assert.equal(second.summary, 'The full post body.', 'content:encoded is the better read');
});

test('unwraps CDATA and strips markup out of titles and descriptions', () => {
  const [first] = parseFeed(RSS).items;
  assert.equal(first.title, 'Bus lanes & the grid');
  /* Feed HTML is normally entity-escaped inside the XML, so it only becomes markup after
     decoding — a single strip pass would leave the reader looking at a literal <p>. */
  assert.equal(first.summary, 'A post about "bus lanes".');
  assert.equal(/[<>]/.test(first.summary), false, 'no markup may survive into stored text');
});

test('strips script and style content rather than turning it into prose', () => {
  assert.equal(stripMarkup('<p>Real text</p><script>alert(1)</script>'), 'Real text');
  assert.equal(stripMarkup('<style>p{color:red}</style>Body'), 'Body');
});

test('resolves named and numeric entities', () => {
  assert.equal(decodeEntities('a &amp; b &#65; &#x42; &quot;c&quot;'), 'a & b A B "c"');
  /* An entity we do not know stays as written rather than becoming something else. */
  assert.equal(decodeEntities('&notreal; &amp;'), '&notreal; &');
});

test('an entry with no date or description still parses, with empty strings', () => {
  const { items } = parseFeed('<rss><channel><item><title>Bare</title><link>https://a.example/x</link></item></channel></rss>');
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedAt, '');
  assert.equal(items[0].summary, '');
  assert.equal(items[0].guid, '');
});

test('tells a feed from the HTML page a moved feed leaves behind', () => {
  assert.equal(looksLikeFeed(RSS), true);
  assert.equal(looksLikeFeed(ATOM), true);
  assert.equal(looksLikeFeed('<rdf:RDF><item/></rdf:RDF>'), true);
  /* Parsing a 404 page yields zero items, which is indistinguishable from a quiet feed. */
  assert.equal(looksLikeFeed('<!doctype html><html><body>Not found</body></html>'), false);
  assert.equal(looksLikeFeed(''), false);
  assert.equal(looksLikeFeed(undefined), false);
});

test('parsing never executes anything it reads', () => {
  const hostile = `<rss><channel><item><title>x</title><link>javascript:alert(1)</link><description><![CDATA[<img src=x onerror=alert(1)>]]></description></item></channel></rss>`;
  const [item] = parseFeed(hostile).items;
  /* The parser reports what it found; rejecting the URL is normalizeFeedItems' job. */
  assert.equal(item.url, 'javascript:alert(1)');
  assert.equal(item.summary, '', 'the img tag is markup and does not survive as text');
  assert.equal(/onerror/.test(item.summary), false);
});
