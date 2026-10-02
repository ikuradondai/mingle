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
process.env.ADMIN_PASSWORD = 'test-password';
const { recordEvent, fetchStats } = await import('../server-side/store.mjs');
const { signSession, verifySession } = await import('../server-side/http.mjs');
const { default: track } = await import('../api/track.js');
const { statsHandler } = await import('../server-side/admin-api.mjs');

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

test('progress events validate, deduplicate, and preserve theme-specific counts', async () => {
  async function invoke(payload) {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]); req.method = 'POST'; req.url = '/api/track'; req.headers = { 'content-type': 'application/json' };
    let status; let result; const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
    await track(req, res); return { status, result };
  }
  const date = `2099-progress-${process.pid}-${Date.now()}`;
  const event = { type: 'round_complete', themeId: 'mix', eventId: 'session-s1-round-complete-6' };
  assert.equal((await invoke(event)).status, 202);
  assert.equal((await invoke(event)).status, 202);
  assert.equal((await invoke({ ...event, extra: true })).status, 400);
  assert.equal((await invoke({ type: 'session_complete', themeId: 'unknown', eventId: 'session-s1-session-complete' })).status, 400);
  await recordEvent({ ...event, date });
  await recordEvent({ type: 'round_continue', themeId: 'mix', eventId: 'session-s1-continue-12', date });
  await recordEvent({ type: 'session_complete', themeId: 'mix', eventId: 'session-s1-session-complete', date });
  const result = await fetchStats([date]);
  assert.equal(result.totals.progress.roundCompletes, 1);
  assert.equal(result.totals.progress.roundContinues, 1);
  assert.equal(result.totals.progress.sessionCompletes, 1);
  assert.equal(result.totals.progressThemes['mix:sessionCompletes'], 1);
});

test('admin stats exposes progress counters consistently for every range', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  process.env.ANALYTICS_ALL_DAYS = today;
  await recordEvent({ type: 'round_complete', themeId: 'date', eventId: `stats-round-${Date.now()}`, date: today });
  await recordEvent({ type: 'round_continue', themeId: 'date', eventId: `stats-continue-${Date.now()}`, date: today });
  await recordEvent({ type: 'session_complete', themeId: 'date', eventId: `stats-session-${Date.now()}`, date: today });
  async function invoke(range) {
    const req = Readable.from([]); req.method = 'GET'; req.url = `/api/admin/stats?range=${range}`; req.headers = { cookie: `mingle_admin=${signSession()}` };
    let status; let result; const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
    await statsHandler(req, res); return { status, result };
  }
  for (const range of ['today', '7d', '30d', 'all']) {
    const { status, result } = await invoke(range);
    assert.equal(status, 200);
    assert.ok(result.totals.roundCompletes >= 1);
    assert.ok(result.totals.roundContinues >= 1);
    assert.ok(result.totals.sessionCompletes >= 1);
    const theme = result.themes.find((item) => item.id === 'date');
    assert.equal(theme.roundCompletes, 1);
    assert.equal(theme.roundContinues, 1);
    assert.equal(theme.sessionCompletes, 1);
    assert.ok(result.daily.some((item) => item.roundCompletes >= 1));
  }
});

test('client progress helper emits six rounds, six continues, and one final completion', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return { ok: true }; };
  try {
    const { trackSessionProgress } = await import(`../dist/analytics.js?client-test=${Date.now()}`);
    const id = `client-${Date.now()}`; const base = { sessionId: id, deckId: 'mix' };
    let current = { ...base, cursor: 0, unlockedUntil: 6 };
    for (let round = 1; round <= 6; round += 1) {
      const complete = { ...current, cursor: round * 6 };
      trackSessionProgress(current, complete);
      current = complete;
      const continued = { ...current, unlockedUntil: Math.min((round + 1) * 6, 40) };
      trackSessionProgress(current, continued);
      current = continued;
    }
    const finished = { ...current, cursor: 40 };
    trackSessionProgress(current, finished);
    trackSessionProgress(null, current);
    trackSessionProgress(current, current);
    assert.equal(calls.filter((item) => item.type === 'round_complete').length, 6);
    assert.equal(calls.filter((item) => item.type === 'round_continue').length, 6);
    assert.equal(calls.filter((item) => item.type === 'session_complete').length, 1);
    assert.ok(calls.every((item) => item.themeId === 'mix' && Object.keys(item).length === 3));
  } finally { globalThis.fetch = originalFetch; }
});
