/**
 * A small feed parser for RSS 2.0, Atom, and RDF/RSS 1.0.
 *
 * This is the one place in the repository that reads a publisher's own markup, and it runs
 * on the reader's machine — `bin/rss-fetch.mjs` calls it, the page never does. A browser tab
 * cannot fetch a feed anyway: the same-origin policy needs `Access-Control-Allow-Origin` on
 * the feed, and virtually no feed sends one. That is why every web-based reader fetches
 * server-side, and why this app puts the fetch on the reader's own computer instead of on
 * ours: our server never learns which feeds anyone subscribes to.
 *
 * The parser is deliberately dumb. It pulls a handful of fields out of the XML and returns
 * plain strings; it never evaluates anything, and everything it returns is treated as
 * untrusted input by `normalizeFeedItems` in `src/data.js`, exactly like text from an agent.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Resolves the five XML entities plus numeric escapes. Not a full HTML entity table. */
export function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : match;
  });
}

function stripTags(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, ' ')
    .replace(/<[^>]*>/g, '');
}

/**
 * Feed descriptions routinely carry HTML. We store text, not markup: the page escapes
 * everything it renders, so a tag left in here shows up as a literal `<p>` to the reader.
 *
 * Two passes, because a feed's HTML is usually entity-escaped inside the XML — a description
 * arrives as `&lt;p&gt;…`, which survives the first tag strip and only becomes a tag once
 * entities are resolved. Stripping again after decoding is what turns that into prose. The
 * cost is that prose deliberately containing `&lt;p&gt;` loses it, which is a fair trade
 * against every ordinary feed rendering as visible markup.
 */
export function stripMarkup(value) {
  const once = decodeEntities(stripTags(value));
  const twice = /<[a-z!/][^>]*>/i.test(once) ? decodeEntities(stripTags(once)) : once;
  return twice.replace(/\s+/g, ' ').trim();
}

function unwrapCdata(value) {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
  return cdata ? cdata[1] : value;
}

/** The text of the first `<name>` child, CDATA unwrapped and entities resolved. */
function tagText(xml, ...names) {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
    if (match) {
      const text = stripMarkup(unwrapCdata(match[1]));
      if (text) return text;
    }
  }
  return '';
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? decodeEntities(match[2] ?? match[3] ?? '') : '';
}

/**
 * An entry's link. RSS puts it in `<link>` as text; Atom puts it in a `<link href>`
 * attribute and may offer several, of which `rel="alternate"` (or no rel at all) is the
 * human-readable one — `rel="self"` points back at the feed and would make every item link
 * to the feed itself.
 */
function entryLink(xml) {
  const candidates = [...xml.matchAll(/<link\b([^>]*)\/?>(?:([\s\S]*?)<\/link>)?/gi)];
  let fallback = '';
  for (const [, attrs = '', inner] of candidates) {
    const href = attribute(attrs, 'href');
    const rel = attribute(attrs, 'rel').toLowerCase();
    const text = stripMarkup(unwrapCdata(inner || ''));
    const url = href || text;
    if (!url) continue;
    if (rel === 'self' || rel === 'hub' || rel === 'replies') continue;
    if (!rel || rel === 'alternate') return url;
    fallback ||= url;
  }
  return fallback;
}

/** Splits the feed into item elements without needing to understand the rest of the document. */
function entryBlocks(xml) {
  return [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
}

/**
 * Feed-level metadata: the channel title and link, read from the document with its entries
 * removed so an item's own `<title>` can never be mistaken for the feed's.
 */
export function parseFeedMeta(xml) {
  const head = String(xml).replace(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '');
  return { title: tagText(head, 'title'), link: entryLink(head), description: tagText(head, 'description', 'subtitle') };
}

/**
 * Every entry in a feed document, in document order. Fields that are missing come back as
 * empty strings rather than undefined, so a caller never has to guess which shape it got.
 */
export function parseFeed(xml) {
  const source = String(xml ?? '');
  return {
    feed: parseFeedMeta(source),
    items: entryBlocks(source).map((block) => ({
      title: tagText(block, 'title'),
      url: entryLink(block),
      /* `isPermaLink="false"` guids are opaque ids, which is exactly what we want them for. */
      guid: tagText(block, 'guid', 'id'),
      publishedAt: tagText(block, 'pubDate', 'published', 'updated', 'dc:date'),
      /* content:encoded first: when a feed carries the full post, that is the better read. */
      summary: tagText(block, 'content:encoded', 'content', 'description', 'summary'),
      author: tagText(block, 'dc:creator', 'author', 'name'),
    })),
  };
}

/** True for a document that is plausibly a feed at all, so a 404 HTML page fails loudly. */
export function looksLikeFeed(xml) {
  return /<(rss|feed|rdf:RDF)\b/i.test(String(xml ?? ''));
}
