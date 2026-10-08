import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasRedis, isProduction, REDIS_PREFIX } from './config.mjs';
import { redisCommand, redisPipeline } from './redis.mjs';

const localPath = process.env.ANALYTICS_LOCAL_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'analytics.json');
const localEnabled = process.env.ANALYTICS_LOCAL_STORE === '1' && !isProduction();
let local = null;
function readLocal() { if (!local) { mkdirSync(dirname(localPath), { recursive: true }); local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : { startedAt: null, updatedAt: null, days: {}, dedup: {}, rate: {} }; } return local; }
function saveLocal() { writeFileSync(localPath, JSON.stringify(local)); }
const PROGRESS_TYPES = { round_complete: 'roundCompletes', round_continue: 'roundContinues', session_complete: 'sessionCompletes' };
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DEDUP_MS = 48 * 60 * 60 * 1000;
export const THEME_LIKE_TTL_SECONDS = 90 * 24 * 60 * 60;
const THEME_LIKE_TTL_MS = THEME_LIKE_TTL_SECONDS * 1000;
const MAX_FEEDBACK = 10000;
const localRetentionEnabled = process.env.NODE_ENV !== 'test';
function dayData(db, date) { return db.days[date] ||= { pageViews: 0, themeStarts: 0, themeLikes: 0, themeLikeThemes: {}, pages: {}, themes: {}, progress: {}, progressThemes: {} }; }
function localRate(key, now) { const db = readLocal(); for (const [stored, value] of Object.entries(db.rate || {})) if (!value || value.reset <= now) delete db.rate[stored]; const r = db.rate[key] ||= { count: 0, reset: now + 60000 }; r.count += 1; saveLocal(); return r.count; }

export function persistentStoreAvailable() { return hasRedis() || localEnabled; }
export function usingLocalStore() { return !hasRedis() && localEnabled; }
function boundedRateKey(key) { return createHash('sha256').update(String(key).slice(0, 512)).digest('hex'); }
export async function consumeRate(key) { const bounded = boundedRateKey(key); if (hasRedis()) return Number(await redisCommand(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, `${REDIS_PREFIX}:rate:${bounded}`])); if (localEnabled) return localRate(bounded, Date.now()); throw new Error('store unavailable'); }
export async function consumeAiQuota(key) {
  const limit = (value, fallback) => (/^[1-9][0-9]{0,5}$/.test(String(value || '')) ? Number(value) : fallback);
  const minuteLimit = limit(process.env.AI_MINUTE_LIMIT, 3);
  const dailyLimit = limit(process.env.AI_DAILY_LIMIT, 30);
  const day = new Date().toISOString().slice(0, 10);
  if (hasRedis()) {
    const result = await redisCommand(['EVAL', "local m=redis.call('INCR',KEYS[1]); if m==1 then redis.call('EXPIRE',KEYS[1],60) end; local d=redis.call('INCR',KEYS[2]); if d==1 then redis.call('EXPIRE',KEYS[2],86400) end; return {m,d}", 2, `${REDIS_PREFIX}:ai:minute:${key}`, `${REDIS_PREFIX}:ai:day:${day}:${key}`]);
    const values = Array.isArray(result) ? result : [result]; return { minute: Number(values[0]), daily: Number(values[1]), minuteLimit, dailyLimit };
  }
  if (localEnabled) {
    const db = readLocal(); const now = Date.now(); const minuteKey = `ai:${key}`; const dayKey = `${day}:${key}`;
    const minute = db.aiMinute ||= {}; const daily = db.aiDaily ||= {};
    if (!minute[minuteKey] || minute[minuteKey].reset < now) minute[minuteKey] = { count: 0, reset: now + 60000 };
    if (!daily[dayKey]) daily[dayKey] = { count: 0 };
    minute[minuteKey].count += 1; daily[dayKey].count += 1; saveLocal();
    return { minute: minute[minuteKey].count, daily: daily[dayKey].count, minuteLimit, dailyLimit };
  }
  throw new Error('store unavailable');
}
export async function recordEvent({ type, pageId, themeId, eventId, date }) {
  if (hasRedis()) {
    const script = `if redis.call('SET', KEYS[6] .. ARGV[1], '1', 'NX', 'EX', 172800) == false then return 0 end; redis.call('SADD', KEYS[7], ARGV[2]); redis.call('SETNX', KEYS[8], ARGV[7]); redis.call('SET', KEYS[9], ARGV[7]); if ARGV[3] == 'page_view' then redis.call('HINCRBY', KEYS[1], 'pageViews', 1); redis.call('HINCRBY', KEYS[2], 'pageViews', 1); redis.call('HINCRBY', KEYS[3], ARGV[4], 1) elseif ARGV[3] == 'theme_start' then redis.call('HINCRBY', KEYS[1], 'themeStarts', 1); redis.call('HINCRBY', KEYS[2], 'themeStarts', 1); redis.call('HINCRBY', KEYS[4], ARGV[5], 1) else redis.call('HINCRBY', KEYS[1], ARGV[6], 1); redis.call('HINCRBY', KEYS[2], ARGV[6], 1); redis.call('HINCRBY', KEYS[5], ARGV[5] .. ':' .. ARGV[6], 1) end; return 1`;
    const metric = PROGRESS_TYPES[type] || '', day = `${REDIS_PREFIX}:day:${date}`, totals = `${REDIS_PREFIX}:totals`, pages = `${REDIS_PREFIX}:pages:${date}`, themes = `${REDIS_PREFIX}:themes:${date}`, progressThemes = `${REDIS_PREFIX}:progressThemes:${date}`, dedup = `${REDIS_PREFIX}:dedup:`, dates = `${REDIS_PREFIX}:dates`, started = `${REDIS_PREFIX}:startedAt`, updated = `${REDIS_PREFIX}:updatedAt`;
    const now = new Date().toISOString();
    return Number(await redisCommand(['EVAL', script, 9, day, totals, pages, themes, progressThemes, dedup, dates, started, updated, eventId, date, type, pageId || '', themeId || '', metric, now]));
  }
  if (!localEnabled) throw new Error('store unavailable');
  const db = readLocal(); const now = Date.now(); const d = dayData(db, date); db.dates ||= {}; for (const [stored, expires] of Object.entries(db.dedup || {})) if (Number(expires) <= now) delete db.dedup[stored]; if (db.dedup[eventId]) return 0; db.dedup[eventId] = now + DEDUP_MS; db.dates[date] = true;
  db.totals ||= { pageViews: 0, themeStarts: 0, pages: {}, themes: {}, progress: {}, progressThemes: {} }; db.totals.progress ||= {}; db.totals.progressThemes ||= {}; d.progress ||= {}; d.progressThemes ||= {};
  d.pageViews += type === 'page_view' ? 1 : 0; d.themeStarts += type === 'theme_start' ? 1 : 0; db.totals.pageViews += type === 'page_view' ? 1 : 0; db.totals.themeStarts += type === 'theme_start' ? 1 : 0;
  if (type === 'page_view') d.pages[pageId] = (d.pages[pageId] || 0) + 1, db.totals.pages[pageId] = (db.totals.pages[pageId] || 0) + 1;
  if (type === 'theme_start') d.themes[themeId] = (d.themes[themeId] || 0) + 1, db.totals.themes[themeId] = (db.totals.themes[themeId] || 0) + 1;
  if (PROGRESS_TYPES[type]) { const metric = PROGRESS_TYPES[type]; d.progress[metric] = (d.progress[metric] || 0) + 1; db.totals.progress[metric] = (db.totals.progress[metric] || 0) + 1; const key = `${themeId}:${metric}`; d.progressThemes[key] = (d.progressThemes[key] || 0) + 1; db.totals.progressThemes[key] = (db.totals.progressThemes[key] || 0) + 1; }
  db.startedAt ||= new Date().toISOString(); db.updatedAt = new Date().toISOString(); saveLocal(); return 1;
}
export async function recordThemeLike({ themeId, voterTokenHash, date }) {
  if (hasRedis()) {
    const script = "if redis.call('SET', KEYS[6] .. ARGV[1], '1', 'NX', 'EX', ARGV[4]) == false then return 0 end; redis.call('HINCRBY', KEYS[1], 'themeLikes', 1); redis.call('HINCRBY', KEYS[2], 'themeLikes', 1); redis.call('HINCRBY', KEYS[3], ARGV[2], 1); redis.call('HINCRBY', KEYS[4], ARGV[2], 1); redis.call('SADD', KEYS[5], ARGV[3]); redis.call('SETNX', KEYS[7], ARGV[5]); redis.call('SET', KEYS[8], ARGV[5]); return 1";
    const day = `${REDIS_PREFIX}:day:${date}`, totals = `${REDIS_PREFIX}:totals`, dayThemes = `${REDIS_PREFIX}:themeLikes:${date}`, totalThemes = `${REDIS_PREFIX}:themeLikeThemes`, dates = `${REDIS_PREFIX}:dates`, dedup = `${REDIS_PREFIX}:themeLikeDedup:`, started = `${REDIS_PREFIX}:startedAt`, updated = `${REDIS_PREFIX}:updatedAt`;
    return Number(await redisCommand(['EVAL', script, 8, day, totals, dayThemes, totalThemes, dates, dedup, started, updated, `${voterTokenHash}:${themeId}`, themeId, date, String(THEME_LIKE_TTL_SECONDS), new Date().toISOString()]));
  }
  if (!localEnabled) throw new Error('store unavailable');
  const db = readLocal(); const now = Date.now(); const d = dayData(db, date); db.themeLikeDedup ||= {};
  for (const [stored, expires] of Object.entries(db.themeLikeDedup)) if (Number(expires) <= now) delete db.themeLikeDedup[stored];
  const dedupKey = `${voterTokenHash}:${themeId}`; if (db.themeLikeDedup[dedupKey]) return 0;
  db.themeLikeDedup[dedupKey] = now + THEME_LIKE_TTL_MS; db.dates ||= {}; db.dates[date] = true;
  db.totals ||= { pageViews: 0, themeStarts: 0, pages: {}, themes: {}, progress: {}, progressThemes: {} }; db.totals.themeLikes = (db.totals.themeLikes || 0) + 1; db.totals.themeLikeThemes ||= {};
  d.themeLikes = (d.themeLikes || 0) + 1; d.themeLikeThemes ||= {}; d.themeLikeThemes[themeId] = (d.themeLikeThemes[themeId] || 0) + 1; db.totals.themeLikeThemes[themeId] = (db.totals.themeLikeThemes[themeId] || 0) + 1;
  db.startedAt ||= new Date().toISOString(); db.updatedAt = new Date().toISOString(); saveLocal(); return 1;
}
export async function recordFeedback({ sessionId, cursor, themeId, themeIds, rating, text, createdAt, date }) {
  const id = `${sessionId}:${cursor}`;
  const item = { id, createdAt, date, themeId, themeIds: [...themeIds], cursor, rating, text };
  if (hasRedis()) {
    const script = "if redis.call('SET', KEYS[1] .. ARGV[1], '1', 'NX', 'EX', ARGV[5]) == false then return 0 end; redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3]); redis.call('EXPIRE', KEYS[2], ARGV[8]); redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[4]); local n=redis.call('ZCARD', KEYS[2]); if n > tonumber(ARGV[6]) then redis.call('ZREMRANGEBYRANK', KEYS[2], 0, n - tonumber(ARGV[6]) - 1) end; redis.call('SADD', KEYS[3], ARGV[7]); return 1";
    const retentionCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return Number(await redisCommand(['EVAL', script, 3, `${REDIS_PREFIX}:feedbackDedup:`, `${REDIS_PREFIX}:feedback`, `${REDIS_PREFIX}:dates`, id, String(Date.parse(createdAt)), JSON.stringify(item), String(retentionCutoff), '172800', '10000', date, String(90 * 24 * 60 * 60)]));
  }
  if (!localEnabled) throw new Error('store unavailable');
  const db = readLocal(); db.feedback ||= []; db.feedbackDedup ||= {}; const now = Date.now(); for (const [stored, expires] of Object.entries(db.feedbackDedup)) if (Number(expires) <= now) delete db.feedbackDedup[stored];
  if (db.feedbackDedup[id]) return 0;
  db.feedbackDedup[id] = now + DEDUP_MS; db.feedback.push(item); db.dates ||= {}; db.dates[date] = true;
  if (localRetentionEnabled) db.feedback = db.feedback.filter((entry) => Date.parse(entry.createdAt) >= now - RETENTION_MS);
  db.feedback.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); if (db.feedback.length > MAX_FEEDBACK) db.feedback.length = MAX_FEEDBACK;
  db.startedAt ||= createdAt; db.updatedAt = createdAt; saveLocal(); return 1;
}
export async function fetchFeedback(dates, limit = 100) {
  dates = await dates;
  const allowed = new Set(dates);
  if (!dates.length || limit <= 0) return [];
  if (hasRedis()) {
    const starts = dates.map((date) => Date.parse(`${date}T00:00:00+09:00`)).filter(Number.isFinite);
    if (!starts.length) return [];
    const min = Math.min(...starts), max = Math.max(...starts) + 24 * 60 * 60 * 1000 - 1;
    const values = await redisCommand(['ZREVRANGEBYSCORE', `${REDIS_PREFIX}:feedback`, String(max), String(min), 'LIMIT', '0', String(limit)]);
    return (values || []).map((value) => { try { return JSON.parse(value); } catch { return null; } }).filter((item) => item && allowed.has(item.date)).slice(0, limit);
  }
  if (!localEnabled) throw new Error('store unavailable');
  return (readLocal().feedback || []).filter((item) => allowed.has(item.date)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}
export async function fetchStats(dates) {
  dates = await dates;
  if (hasRedis()) {
    const commands = [['HGETALL', `${REDIS_PREFIX}:totals`], ['GET', `${REDIS_PREFIX}:startedAt`], ['GET', `${REDIS_PREFIX}:updatedAt`]];
    commands.push(['HGETALL', `${REDIS_PREFIX}:themeLikeThemes`]);
    for (const d of dates) commands.push(['HGETALL', `${REDIS_PREFIX}:day:${d}`], ['HGETALL', `${REDIS_PREFIX}:pages:${d}`], ['HGETALL', `${REDIS_PREFIX}:themes:${d}`], ['HGETALL', `${REDIS_PREFIX}:progressThemes:${d}`], ['HGETALL', `${REDIS_PREFIX}:themeLikes:${d}`]);
    const out = await redisPipeline(commands); return { totals: hash(out[0]), themeLikeThemes: hash(out[3]), startedAt: out[1], updatedAt: out[2], days: dates.map((date, i) => ({ date, day: hash(out[4 + i * 5]), pages: hash(out[5 + i * 5]), themes: hash(out[6 + i * 5]), progressThemes: hash(out[7 + i * 5]), themeLikeThemes: hash(out[8 + i * 5]) })) };
  }
  if (!localEnabled) throw new Error('store unavailable'); const db = readLocal(); return { totals: db.totals || {}, themeLikeThemes: db.totals?.themeLikeThemes || {}, days: dates.map((date) => { const source = db.days[date] || {}; const day = { ...source, ...(source.progress || {}) }; return { date, day, pages: source.pages || {}, themes: source.themes || {}, progressThemes: source.progressThemes || {}, themeLikeThemes: source.themeLikeThemes || {} }; }), startedAt: db.startedAt, updatedAt: db.updatedAt };
}
export async function fetchThemeStartStats(dates) {
  dates = await dates;
  if (hasRedis()) {
    const commands = dates.map((date) => ['HGETALL', `${REDIS_PREFIX}:themes:${date}`]);
    const out = await redisPipeline(commands);
    return { days: dates.map((date, index) => ({ date, themes: hash(out[index]) })) };
  }
  if (!localEnabled) throw new Error('store unavailable');
  const db = readLocal();
  return { days: dates.map((date) => ({ date, themes: (db.days[date] || {}).themes || {} })) };
}
export async function knownDates() { if (hasRedis()) return (await redisCommand(['SMEMBERS', `${REDIS_PREFIX}:dates`])).sort(); if (!localEnabled) throw new Error('store unavailable'); return Object.keys(readLocal().dates || {}).sort(); }
function hash(value) { const o = {}; for (let i = 0; i < (value || []).length; i += 2) o[value[i]] = Number(value[i + 1]); return o; }
