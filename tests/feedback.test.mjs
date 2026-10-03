import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

process.env.ANALYTICS_LOCAL_STORE = '1';
process.env.NODE_ENV = 'test';
process.env.ANALYTICS_NAMESPACE = `feedback-${process.pid}-${Date.now()}`;
process.env.ANALYTICS_LOCAL_PATH = join(await mkdtemp(join(tmpdir(), 'mingle-feedback-')), 'analytics.json');
process.env.ADMIN_SESSION_SECRET = 'feedback-session-secret';
process.env.ADMIN_PASSWORD = 'feedback-password';
const { default: feedback } = await import('../api/feedback.js');
const { signSession } = await import('../server-side/http.mjs');
const { statsHandler } = await import('../server-side/admin-api.mjs');
const { recordFeedback } = await import('../server-side/store.mjs');

function request(payload, { method = 'POST', origin, bodyObject = false } = {}) {
  const raw = JSON.stringify(payload);
  const req = bodyObject ? Readable.from([]) : Readable.from([Buffer.from(raw)]);
  req.method = method; req.url = '/api/feedback'; req.headers = { 'content-type': 'application/json', ...(origin ? { origin, host: 'localhost' } : {}) };
  if (bodyObject) req.body = payload;
  let status; let result;
  const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
  return feedback(req, res).then(() => ({ status, result }));
}
function rawRequest(raw) {
  const req = Readable.from([Buffer.from(raw)]); req.method = 'POST'; req.url = '/api/feedback'; req.headers = { 'content-type': 'application/json' };
  let status; let result; const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
  return feedback(req, res).then(() => ({ status, result }));
}

const base = { sessionId: 'feedback-session-1', cursor: 6, themeId: 'date', themeIds: ['date'], rating: 'positive', text: '' };

test('feedback validates payload, accepts unicode 1000 chars, and deduplicates first write', async () => {
  assert.equal((await request({ ...base, text: 'あ'.repeat(1000) }, { bodyObject: true })).status, 200);
  const duplicate = await request({ ...base, text: '後から変えた内容' }, { bodyObject: true });
  assert.deepEqual(duplicate.result, { ok: true, duplicate: true });
  assert.equal((await request({ ...base, sessionId: 'feedback-session-2', rating: null, text: '  本文  ' }, { bodyObject: true })).status, 200);
  assert.equal((await request({ ...base, sessionId: 'feedback-session-3', rating: null, text: '' }, { bodyObject: true })).status, 400);
  assert.equal((await request({ ...base, sessionId: 'feedback-session-4', extra: true }, { bodyObject: true })).status, 400);
  assert.equal((await request({ ...base, sessionId: 'feedback-session-5', text: 'x'.repeat(9000) }, { bodyObject: true })).status, 413);
  assert.equal((await request({ ...base, sessionId: 'feedback-session-11', text: 'x'.repeat(1001) }, { bodyObject: true })).status, 400);
  assert.equal((await rawRequest('{"sessionId":')).status, 400);
});

test('feedback validates cursor, themes, rating, and origin', async () => {
  assert.equal((await request({ ...base, sessionId: 'feedback-session-6', cursor: 7 }, { bodyObject: true })).status, 400);
  assert.equal((await request({ ...base, sessionId: 'feedback-session-7', themeId: 'unknown', themeIds: ['unknown'] }, { bodyObject: true })).status, 400);
  assert.equal((await request({ ...base, sessionId: 'feedback-session-8', themeId: 'mix', themeIds: ['date'] }, { bodyObject: true })).status, 400);
  assert.equal((await request({ ...base, sessionId: 'feedback-session-9', themeId: 'mix', themeIds: ['date', 'friends'] }, { bodyObject: true })).status, 200);
  assert.equal((await request({ ...base, sessionId: 'feedback-session-10', rating: 'bad' }, { bodyObject: true })).status, 400);
  assert.equal((await request(base, { origin: 'https://evil.example', bodyObject: true })).status, 403);
  assert.equal((await request({ ...base, sessionId: 'feedback-my-set-1', cursor: 7, themeId: 'my-set', themeIds: ['my-set'] }, { bodyObject: true })).status, 200);
  assert.equal((await request({ ...base, sessionId: 'feedback-my-set-2', cursor: 13, themeId: 'my-set', themeIds: ['date'] }, { bodyObject: true })).status, 400);
  assert.equal((await request({ ...base, sessionId: 'feedback-my-set-3', cursor: 41, themeId: 'my-set', themeIds: ['my-set'] }, { bodyObject: true })).status, 400);
});

test('admin stats keeps existing shape and returns recent feedback only for selected period', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dateOffset = (days) => { const value = new Date(); value.setDate(value.getDate() - days); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); };
  const recentDate = dateOffset(3), oldDate = dateOffset(15), ancientDate = dateOffset(31);
  const at = (date, hour) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  await recordFeedback({ sessionId: 'feedback-period-recent', cursor: 6, themeId: 'friends', themeIds: ['friends'], rating: 'positive', text: 'recent', createdAt: at(recentDate, 12), date: recentDate });
  await recordFeedback({ sessionId: 'feedback-period-old', cursor: 12, themeId: 'date', themeIds: ['date'], rating: 'needs_improvement', text: 'old', createdAt: at(oldDate, 12), date: oldDate });
  await recordFeedback({ sessionId: 'feedback-period-ancient', cursor: 18, themeId: 'team', themeIds: ['team'], rating: 'positive', text: 'ancient', createdAt: at(ancientDate, 12), date: ancientDate });
  process.env.ANALYTICS_ALL_DAYS = [today, recentDate, oldDate, ancientDate].join(',');
  async function invoke(range, cookie = `mingle_admin=${signSession()}`) {
    const req = Readable.from([]); req.method = 'GET'; req.url = `/api/admin/stats?range=${range}`; req.headers = { cookie };
    let status; let result; const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
    await statsHandler(req, res); return { status, result };
  }
  const all = await invoke('all');
  assert.equal(all.status, 200);
  assert.ok(Array.isArray(all.result.feedback));
  assert.equal(all.result.feedbackLimit, 100);
  assert.ok(all.result.feedback.some((item) => item.themeId === 'date'));
  assert.ok(all.result.feedback.some((item) => item.text === 'あ'.repeat(1000)));
  assert.ok(all.result.feedback.some((item) => item.text === 'ancient'));
  assert.deepEqual([...all.result.feedback].map((item) => item.createdAt), [...all.result.feedback].map((item) => item.createdAt).sort().reverse());
  const todayResult = await invoke('today');
  const weekResult = await invoke('7d');
  const monthResult = await invoke('30d');
  assert.ok(todayResult.result.feedback.every((item) => item.date === today));
  assert.ok(weekResult.result.feedback.every((item) => item.date === today || item.date === recentDate));
  assert.ok(monthResult.result.feedback.every((item) => item.date !== ancientDate));
  for (let index = 0; index < 105; index += 1) await recordFeedback({ sessionId: `feedback-cap-${String(index).padStart(3, '0')}`, cursor: 6, themeId: 'friends', themeIds: ['friends'], rating: 'positive', text: String(index), createdAt: at(today, 13) .replace('.000Z', `.${String(index).padStart(3, '0')}Z`), date: today });
  const capped = await invoke('today');
  assert.equal(capped.result.feedback.length, 100);
  assert.equal((await invoke('today', '')).status, 401);
});
