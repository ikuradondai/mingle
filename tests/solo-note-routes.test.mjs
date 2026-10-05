import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
process.env.SUPABASE_URL = 'https://solo-route.test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_solo_route';
const { default: route } = await import('../api/account/solo-notes.js');

function sink() { let status; let value; return { res: { setHeader() {}, writeHead(code) { status = code; }, end(body) { value = JSON.parse(body); } }, result() { return { status, value }; } }; }
function request(path, method = 'GET') { const req = Readable.from([]); req.method = method; req.url = path; req.headers = { host: 'localhost' }; return req; }

test('solo note explicit wrapper reaches shared service auth and rejects unsupported methods', async () => {
  for (const method of ['GET', 'PUT']) {
    const output = sink(); await route(request('/api/account/solo-notes', method), output.res); assert.equal(output.result().status, 401); assert.equal(output.result().value.error, 'UNAUTHENTICATED');
  }
  const output = sink(); await route(request('/api/account/solo-notes', 'POST'), output.res); assert.equal(output.result().status, 405); assert.equal(output.result().value.error, 'METHOD_NOT_ALLOWED');
});
