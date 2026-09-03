#!/usr/bin/env node
/**
 * Fetch subscribed feeds on the reader's own machine and print the result as JSON.
 *
 * A desktop feed reader polls feeds locally and nothing about the reader's subscriptions
 * leaves their computer. This script is how a web app gets the same property. The page
 * cannot fetch feeds itself — the same-origin policy requires `Access-Control-Allow-Origin`
 * on the feed and almost no feed sends one, which is why every hosted reader polls
 * server-side — and putting a fetcher on our server would mean our server learning exactly
 * which publications each account follows. That is the one thing the encryption is for.
 *
 * So the fetch runs here, wherever the reader (or an agent working on their behalf) runs it,
 * and the output is handed back to the page through the `deliver-rss-items` WebMCP tool. The
 * server sees ciphertext, as it does for everything else.
 *
 * Usage:
 *   node bin/rss-fetch.mjs <feedUrl> [feedUrl...]
 *   node bin/rss-fetch.mjs --allow-local http://nas.local/feed.xml   # a feed you host yourself
 *   node bin/rss-fetch.mjs --feeds feeds.json     # the list-subscription-feeds tool output
 *   list-subscription-feeds | node bin/rss-fetch.mjs --feeds -
 *
 * Output: {"deliveries":[{"feedUrl":"…","items":[…]}],"errors":[…]}, shaped so each entry of
 * `deliveries` is a complete `deliver-rss-items` argument object. Feeds that fail are
 * reported in `errors` and never silently dropped — a feed that stopped publishing and a
 * feed that 404s look identical otherwise.
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { parseFeed, looksLikeFeed } from '../src/rss.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 50;
const TIMEOUT_MS = 15_000;
const USER_AGENT = '4.0-reads/0.1 (+local feed fetcher; run by the reader)';

function usage(message) {
  process.stderr.write(`${message}\n\nUsage: node bin/rss-fetch.mjs <feedUrl> [feedUrl...]\n       node bin/rss-fetch.mjs --feeds <file|-> \n`);
  process.exit(2);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Feed URLs from the arguments, or from the JSON that `list-subscription-feeds` returns.
 * Accepting that shape directly is the point: the tool says which feeds are subscribed and
 * this script fetches exactly those, so nothing has to retype a URL and get it wrong.
 */
async function feedUrls(argv) {
  const flag = argv.indexOf('--feeds');
  if (flag === -1) return argv.filter((value) => !value.startsWith('-'));
  const target = argv[flag + 1];
  if (!target) usage('--feeds needs a file path, or - for standard input.');
  const raw = target === '-' ? await readStdin() : await readFile(target, 'utf8');
  let payload;
  try { payload = JSON.parse(raw); } catch { usage('That feed list is not valid JSON.'); }
  const list = Array.isArray(payload) ? payload : payload?.feeds || [];
  return list.map((entry) => (typeof entry === 'string' ? entry : entry?.feedUrl)).filter(Boolean);
}

/**
 * Only http(s), and by default nothing on this machine or its network.
 *
 * Feed URLs reach this script from a subscription an assistant may have filled in, so an
 * unguarded fetcher running on the reader's own computer is a way to probe their LAN from
 * outside it. A reader hosting their own feed can pass `--allow-local` and take that on
 * knowingly; the default refuses.
 */
function checkUrl(value, allowLocal = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('not a URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`unsupported protocol ${url.protocol}`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isPrivate = host === 'localhost' || host.endsWith('.localhost') || host === '::1'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
    || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host);
  if (isPrivate && !allowLocal) throw new Error('refusing a private or loopback address; pass --allow-local for a feed you host yourself');
  return url.href;
}

async function fetchFeed(feedUrl, allowLocal) {
  const url = checkUrl(feedUrl, allowLocal);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5', 'user-agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error(`feed is larger than ${MAX_BYTES} bytes`);
  /* A publisher who moved their feed usually serves an HTML page at the old address. Parsing
     it would yield zero items and look like a feed that went quiet, so say which it was. */
  if (!looksLikeFeed(body)) throw new Error('the response is not an RSS, Atom, or RDF feed');
  const { feed, items } = parseFeed(body);
  return {
    feedUrl: url,
    feedTitle: feed.title,
    items: items.slice(0, MAX_ITEMS).map((item) => ({
      title: item.title, url: item.url, guid: item.guid,
      publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : '',
      summary: item.summary, author: item.author,
    })).filter((item) => item.title && item.url),
  };
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) usage('Fetches subscribed feeds locally and prints deliver-rss-items payloads.');

const urls = [...new Set(await feedUrls(argv))];
if (!urls.length) usage('No feed URLs given.');

const allowLocal = argv.includes('--allow-local');
const settled = await Promise.allSettled(urls.map((url) => fetchFeed(url, allowLocal)));
const deliveries = [];
const errors = [];
settled.forEach((result, index) => {
  if (result.status === 'fulfilled') deliveries.push(result.value);
  else errors.push({ feedUrl: urls[index], error: result.reason?.message || String(result.reason) });
});

process.stdout.write(`${JSON.stringify({ deliveries, errors }, null, 2)}\n`);
/* A run where every feed failed is a failed run: a wrapper should not treat it as "no news". */
if (!deliveries.length && errors.length) process.exit(1);
