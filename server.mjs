import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionHandler, statsHandler } from './server-side/admin-api.mjs';
import trackHandler from './api/track.js';
import feedbackHandler from './api/feedback.js';
import accountHandler from './api/account.js';

const root = normalize(fileURLToPath(new URL('./dist/', import.meta.url))).replace(/[\\/]+$/, '');
const port = Number(process.env.PORT || 5180);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };

function safePath(urlPath) {
  try {
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
    const target = normalize(join(root, relative));
    return target === root || target.startsWith(root + sep) ? target : null;
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  if (pathname === '/api/admin/session') return sessionHandler(request, response);
  if (pathname === '/api/admin/stats') return statsHandler(request, response);
  if (pathname === '/api/track') return trackHandler(request, response);
  if (pathname === '/api/feedback') return feedbackHandler(request, response);
  if (pathname === '/api/account' || pathname.startsWith('/api/account/')) return accountHandler(request, response);
  if (pathname === '/admin' || pathname === '/admin/') request.url = '/admin.html';
  const target = safePath(request.url || '/');
  if (!target) { response.writeHead(400); response.end('Bad Request'); return; }
  try {
    const stat = statSync(target);
    if (!stat.isFile()) throw new Error('not file');
    response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  }
});

server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`MingleCard preview: http://127.0.0.1:${port}`));
