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
const { recordEvent, recordThemeLike, fetchStats } = await import('../server-side/store.mjs');
const { revokeSession, signSession, verifySession, verifySessionAsync } = await import('../server-side/http.mjs');
const { default: track, recommendationLabels } = await import('../api/track.js');
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

test('public recommendation labels require a meaningful unique rank and increase', () => {
  assert.deepEqual(recommendationLabels({ days: [{ themes: { date: 8, friends: 3 } }, { themes: { date: 4 } }] }), { date: 'yesterday_top' });
  assert.deepEqual(recommendationLabels({ days: [{ themes: { date: 8, friends: 8 } }, { themes: { date: 4, friends: 4 } }] }), { date: 'rising', friends: 'rising' });
  assert.deepEqual(recommendationLabels({ days: [{ themes: { date: 8, friends: 5 } }, { themes: { date: 4, friends: 5 } }] }), { date: 'yesterday_top' });
  assert.deepEqual(recommendationLabels({ days: [{ themes: { date: 4 } }, { themes: { date: 1 } }] }), {});
});

test('public recommendation GET returns only bounded labels and accepts admin sessions', async () => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const yesterday = fmt.format(new Date(Date.now() - 86400000));
  await recordEvent({ type: 'theme_start', themeId: 'date', eventId: `public-label-${Date.now()}`, date: yesterday });
  const req = Readable.from([]); req.method = 'GET'; req.url = '/api/track?view=recommendations'; req.headers = { cookie: `mingle_admin=${signSession()}` }; req.socket = { remoteAddress: 'public-label-test' };
  let status; let result; const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
  await track(req, res);
  assert.equal(status, 200);
  assert.equal(result.asOf, yesterday);
  assert.ok(result.labels && typeof result.labels === 'object');
  assert.equal(Object.hasOwn(result, 'counts'), false);
});

test('recommendation loader retries after a short backoff and validates asOf', async () => {
  const originalFetch = globalThis.fetch; const originalTimer = globalThis.setTimeout; const originalNow = Date.now; const calls = []; const timers = [];
  let now = originalNow(); Date.now = () => now;
  globalThis.setTimeout = (callback) => { timers.push(callback); return timers.length; };
  try {
    globalThis.fetch = async () => { calls.push('failed'); return { ok: false }; };
    const failed = await import(`../dist/recommendation-labels.js?labels-failed=${Date.now()}`);
    failed.loadRecommendationLabels(); await new Promise((resolve) => originalTimer(resolve, 0));
    assert.equal(calls.length, 1);
    const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [year, month, day] = current.split('-').map(Number); const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.UTC(year, month - 1, day - 1)));
    globalThis.fetch = async () => { calls.push('success'); return { ok: true, json: async () => ({ asOf: yesterday, labels: { date: 'rising' } }) }; };
    now += 30 * 1000 + 1; timers.shift()(); await new Promise((resolve) => originalTimer(resolve, 0));
    assert.equal(failed.recommendationLabel('date'), 'rising');
    assert.equal(calls.length, 2);
  } finally { Date.now = originalNow; globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimer; }
});

test('signed sessions reject tampering and expiry', () => {
  const token = signSession();
  assert.equal(verifySession(token), true);
  assert.equal(verifySession(`${token}x`), false);
  const old = Buffer.from(JSON.stringify({ exp: Date.now() - 1, n: 'old' })).toString('base64url');
  const expired = `${old}.${createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(old).digest('base64url')}`;
  assert.equal(verifySession(expired), false);
  const [payload, signature] = token.split('.');
  const alternate = `${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
  assert.equal(verifySession(alternate), false);
});

test('admin logout revokes the exact signed session', async () => {
  const token = signSession();
  assert.equal(await verifySessionAsync(token), true);
  assert.equal(await revokeSession(token), true);
  assert.equal(verifySession(token), false);
  assert.equal(await verifySessionAsync(token), false);
  assert.equal(verifySession(`${token}.extra`), false);
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

test('theme likes deduplicate by browser token and reject non-official or text-bearing payloads', async () => {
  async function invoke(payload, address = 'theme-like-test') {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]); req.method = 'POST'; req.url = '/api/track'; req.socket = { remoteAddress: address }; req.headers = { 'content-type': 'application/json' };
    let status; let result; const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
    await track(req, res); return { status, result };
  }
  const token = 'voter-token-abcdefghijklmnopqrstuvwxyz';
  const first = await invoke({ type: 'theme_like', themeId: 'date', voterToken: token, eventId: 'theme-like-event-1' });
  const retry = await invoke({ type: 'theme_like', themeId: 'date', voterToken: token, eventId: 'theme-like-event-2' });
  const otherTheme = await invoke({ type: 'theme_like', themeId: 'friends', voterToken: token, eventId: 'theme-like-event-3' });
  assert.deepEqual(first, { status: 202, result: { ok: true, accepted: true } });
  assert.deepEqual(retry, { status: 202, result: { ok: true, accepted: false } });
  assert.deepEqual(otherTheme, { status: 202, result: { ok: true, accepted: true } });
  for (const themeId of ['mix', 'my-set', 'shared-set', 'unknown-theme']) assert.equal((await invoke({ type: 'theme_like', themeId, voterToken: token, eventId: `theme-like-${themeId}` })).status, 400);
  assert.equal((await invoke({ type: 'theme_like', themeId: 'date', voterToken: token, eventId: 'theme-like-event-5', text: 'private' })).status, 400);
  assert.equal((await invoke({ type: 'theme_like', themeId: 'date', voterToken: 'short', eventId: 'theme-like-event-6' })).status, 400);
});

test('theme likes use a separate low rate bucket without limiting page events', async () => {
  async function invoke(payload, address) {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]); req.method = 'POST'; req.url = '/api/track'; req.socket = { remoteAddress: address }; req.headers = { 'content-type': 'application/json' };
    let status; const res = { setHeader() {}, writeHead(code) { status = code; }, end() {} }; await track(req, res); return status;
  }
  const token = 'voter-token-rate-limit-abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < 20; i += 1) assert.notEqual(await invoke({ type: 'theme_like', themeId: 'date', voterToken: `${token}${String(i).padStart(2, '0')}`, eventId: `theme-rate-${i}` }, 'theme-like-rate'), 429);
  assert.equal(await invoke({ type: 'theme_like', themeId: 'date', voterToken: `${token}21`, eventId: 'theme-rate-21' }, 'theme-like-rate'), 429);
  assert.notEqual(await invoke({ type: 'page_view', pageId: 'participants', eventId: 'page-after-theme-rate' }, 'theme-like-rate'), 429);
});

test('Redis theme-like EVAL and stats pipeline preserve atomic dedup, TTL, timestamps, and new fields', async () => {
  const originalFetch = globalThis.fetch; const originalUrl = process.env.UPSTASH_REDIS_REST_URL; const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN; const calls = []; let redisEvalCount = 0;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';
  globalThis.fetch = async (_url, options = {}) => {
    const commands = JSON.parse(options.body); calls.push(commands);
    if (commands.length === 1 && commands[0][0] === 'EVAL') return { ok: true, async json() { return [{ result: redisEvalCount++ === 0 ? 1 : 0 }]; } };
    return { ok: true, async json() {
      return commands.map((_command, index) => {
        let result = [];
        if (index === 0) result = ['themeLikes', '2'];
        else if (index === 1) result = '2026-10-08T00:00:00.000Z';
        else if (index === 2) result = '2026-10-08T01:00:00.000Z';
        else if (index === 3) result = ['date', '1', 'friends', '1'];
        else if (index === 4) result = ['themeLikes', '2'];
        else if (index === 8) result = ['date', '1', 'friends', '1'];
        return { result };
      });
    } };
  };
  try {
    assert.equal(await recordThemeLike({ themeId: 'date', voterTokenHash: 'redis-hash', date: '2026-10-08' }), 1);
    assert.equal(await recordThemeLike({ themeId: 'date', voterTokenHash: 'redis-hash', date: '2026-10-08' }), 0);
    const evalCommand = calls[0][0]; assert.equal(evalCommand[0], 'EVAL'); assert.equal(evalCommand[2], 8); assert.equal(evalCommand[14], '7776000'); assert.ok(evalCommand.some((value) => String(value).includes(':themeLikeDedup:'))); assert.ok(String(evalCommand[1]).includes('SETNX')); assert.ok(String(evalCommand[1]).includes("'SET'"));
    const redisStats = await fetchStats(['2026-10-08']);
    assert.equal(redisStats.totals.themeLikes, 2); assert.deepEqual(redisStats.themeLikeThemes, { date: 1, friends: 1 }); assert.equal(redisStats.days[0].day.themeLikes, 2); assert.deepEqual(redisStats.days[0].themeLikeThemes, { date: 1, friends: 1 });
  } finally { globalThis.fetch = originalFetch; if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = originalUrl; if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken; }
});

test('theme likes expose bounded daily and total theme counts without changing existing metrics', async () => {
  const date = `2099-theme-like-${process.pid}-${Date.now()}`;
  assert.equal(await recordThemeLike({ themeId: 'date', voterTokenHash: 'hash-a', date }), 1);
  assert.equal(await recordThemeLike({ themeId: 'date', voterTokenHash: 'hash-a', date }), 0);
  assert.equal(await recordThemeLike({ themeId: 'friends', voterTokenHash: 'hash-a', date }), 1);
  const result = await fetchStats([date]);
  assert.equal(result.days[0].day.themeLikes, 2);
  assert.deepEqual(result.days[0].themeLikeThemes, { date: 1, friends: 1 });
  assert.ok(result.totals.themeLikeThemes.date >= 1);
  assert.equal(result.days[0].day.pageViews || 0, 0);
});

test('analytics rate limits count only valid writes', async () => {
  const invoke = async (type, index) => {
    const payload = type === 'track' ? { type: 'page_view', pageId: 'participants', eventId: `rate-${index}-${Date.now()}` } : { sessionId: `rate-session-${index}`, cursor: 6, themeId: 'date', themeIds: ['date'], rating: 'positive', text: 'ok' };
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]); req.method = 'POST'; req.url = `/api/${type === 'track' ? 'track' : 'feedback'}`; req.socket = { remoteAddress: `rate-test-${type}` }; req.headers = { 'content-type': 'application/json' };
    let status; const res = { setHeader() {}, writeHead(code) { status = code; }, end() {} };
    const handler = type === 'track' ? track : (await import('../api/feedback.js')).default; await handler(req, res); return status;
  };
  for (let i = 0; i < 60; i += 1) assert.notEqual(await invoke('track', i), 429);
  assert.equal(await invoke('track', 60), 429);
  for (let i = 0; i < 10; i += 1) assert.notEqual(await invoke('feedback', i), 429);
  assert.equal(await invoke('feedback', 10), 429);
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
  await recordThemeLike({ themeId: 'date', voterTokenHash: `stats-like-${Date.now()}`, date: today });
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
    assert.ok(result.totals.themeLikes >= 1);
    const theme = result.themes.find((item) => item.id === 'date');
    assert.equal(theme.roundCompletes, 1);
    assert.equal(theme.roundContinues, 1);
    assert.equal(theme.sessionCompletes, 1);
    assert.ok(theme.likeCount >= 1);
    assert.ok(result.daily.some((item) => item.roundCompletes >= 1));
    assert.ok(result.daily.some((item) => item.themeLikes >= 1));
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
