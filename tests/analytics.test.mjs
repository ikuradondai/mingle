import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

process.env.ANALYTICS_LOCAL_STORE = '1';
process.env.NODE_ENV = 'test';
process.env.ANALYTICS_NAMESPACE = `test-${process.pid}-${Date.now()}`;
process.env.ANALYTICS_LOCAL_PATH = join(await mkdtemp(join(tmpdir(), 'mingle-analytics-')), 'analytics.json');
process.env.ADMIN_SESSION_SECRET = 'test-session-secret';
const { recordEvent, fetchStats } = await import('../server-side/store.mjs');
const { signSession, verifySession } = await import('../server-side/http.mjs');
const { default: track } = await import('../api/track.js');

test('analytics records page views and theme starts separately and deduplicates retries', async () => {
  const date = `2099-test-${process.pid}-${Date.now()}`;
  await recordEvent({ type: 'page_view', pageId: 'participants', eventId: `test-page-${Date.now()}`, date });
  const event = `test-theme-${Date.now()}`;
  await recordEvent({ type: 'theme_start', themeId: 'date', eventId: event, date });
  assert.equal(await recordEvent({ type: 'theme_start', themeId: 'date', eventId: event, date }), 0);
  const result = await fetchStats([date]);
  assert.equal(result.days[0].day.pageViews, 1);
  assert.equal(result.days[0].day.themeStarts, 1);
  assert.equal(result.days[0].pages.participants, 1);
  assert.equal(result.days[0].themes.date, 1);
});

test('signed sessions reject tampering and expiry', () => {
  const token = signSession();
  assert.equal(verifySession(token), true);
  assert.equal(verifySession(`${token}x`), false);
  const old = Buffer.from(JSON.stringify({ exp: Date.now() - 1, n: 'old' })).toString('base64url');
  const expired = `${old}.${createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(old).digest('base64url')}`;
  assert.equal(verifySession(expired), false);
});

test('tracker rejects unknown fields and invalid ids', async () => {
  async function invoke(payload) {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]); req.method = 'POST'; req.url = '/api/track'; req.headers = { 'content-type': 'application/json' };
    let status; let result; const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
    await track(req, res); return { status, result };
  }
  assert.equal((await invoke({ type: 'page_view', pageId: 'participants', eventId: 'bad', extra: true })).status, 400);
  assert.equal((await invoke({ type: 'page_view', pageId: 'unknown', eventId: 'valid-event-id' })).status, 400);
});
