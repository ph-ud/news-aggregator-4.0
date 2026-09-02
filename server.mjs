import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './server/db.mjs';
import { handleApi } from './server/api.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const db = openDatabase();

/**
 * Deny by default, then allow only what the app actually loads.
 *
 * This is not a defence against a malicious operator — they write the policy. It is a
 * defence against cross-site scripting, which matters here because the master key lives
 * in the page: it is non-extractable, so injected script cannot steal the raw key, but it
 * could still use it to decrypt the library and post the plaintext out. The UI builds all
 * of its markup with innerHTML from agent-supplied text, so one missed escape is a full
 * compromise, and this is the backstop for that.
 *
 * - style-src needs 'unsafe-inline' for style attributes such as --reader-scale. Injected
 *   CSS is far less dangerous than injected script, so this concession stays.
 * - img-src is deliberately wide: article images are chosen by the agent, not by us. Plain
 *   http is left out because mixed content is blocked over https anyway.
 * - base-uri matters more than it looks: without it an injected <base> retargets every
 *   relative module import.
 * - form-action 'none' keeps an injected form from posting a passphrase anywhere; the real
 *   auth form is handled entirely in JavaScript.
 */
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/') && await handleApi(db, request, response, url)) return;
  const { pathname } = url;
  const filePath = normalize(join(root, pathname === '/' ? '/index.html' : pathname));
  if (relative(root, filePath).startsWith('..')) { response.writeHead(403); response.end('Forbidden'); return; }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Origin-Agent-Cluster': '?1', 'Permissions-Policy': 'tools=(self)', 'Content-Security-Policy': contentSecurityPolicy, 'X-Content-Type-Options': 'nosniff' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});

server.listen(port, () => console.log(`4.0-reads running at http://localhost:${server.address().port}`));
