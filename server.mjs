import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './server/db.mjs';
import { handleApi } from './server/api.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const db = openDatabase();
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/') && await handleApi(db, request, response, url)) return;
  const { pathname } = url;
  const filePath = normalize(join(root, pathname === '/' ? '/index.html' : pathname));
  if (relative(root, filePath).startsWith('..')) { response.writeHead(403); response.end('Forbidden'); return; }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Origin-Agent-Cluster': '?1', 'Permissions-Policy': 'tools=(self)' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});

server.listen(port, () => console.log(`4.0-reads running at http://localhost:${server.address().port}`));
