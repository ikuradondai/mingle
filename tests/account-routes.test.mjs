import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.SUPABASE_URL = 'https://route-test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_route_test';
const [favoriteRoute, setRoute, cardRoute, avatarRoute] = await Promise.all([
  import('../api/account/favorites/[cardId].js'),
  import('../api/account/sets/[setId].js'),
  import('../api/account/cards/[cardId].js'),
  import('../api/account/avatar.js'),
]);
const [shareRoute, shareStartRoute, shareSetRoute] = await Promise.all([
  import('../api/share/[token].js'),
  import('../api/share/[token]/start.js'),
  import('../api/account/sets/[setId]/share.js'),
]);

function request(path) {
  const req = Readable.from([]);
  req.method = 'GET'; req.url = path; req.headers = { host: 'localhost' };
  return req;
}
function sink() {
  let status; let value;
  return { res: { setHeader() {}, writeHead(code) { status = code; }, end(body) { value = JSON.parse(body); } }, result() { return { status, value }; } };
}

test('nested account route entries reach the shared handler before auth', async () => {
  for (const [handler, path] of [[favoriteRoute.default, '/api/account/favorites/intimacy-07'], [setRoute.default, '/api/account/sets/00000000-0000-4000-8000-000000000001'], [cardRoute.default, '/api/account/cards/custom:11111111-1111-4111-8111-111111111111'], [avatarRoute.default, '/api/account/avatar']]) {
    const output = sink();
    await handler(request(path), output.res);
    assert.equal(output.result().status, 401, path);
    assert.equal(output.result().value.error, 'UNAUTHENTICATED', path);
  }
});

test('share dynamic route entries export handlers for metadata, start, and owner control', () => {
  assert.equal(typeof shareRoute.default, 'function');
  assert.equal(typeof shareStartRoute.default, 'function');
  assert.equal(typeof shareSetRoute.default, 'function');
});
