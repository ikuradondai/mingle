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
function dayData(db, date) { return db.days[date] ||= { pageViews: 0, themeStarts: 0, pages: {}, themes: {} }; }
function localRate(key, now) { const db = readLocal(); const r = db.rate[key] ||= { count: 0, reset: now + 60000 }; if (r.reset < now) { r.count = 0; r.reset = now + 60000; } r.count += 1; saveLocal(); return r.count; }

export function persistentStoreAvailable() { return hasRedis() || localEnabled; }
export function usingLocalStore() { return !hasRedis() && localEnabled; }
export async function consumeRate(key) { if (hasRedis()) return Number(await redisCommand(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, `${REDIS_PREFIX}:rate:${key}`])); if (localEnabled) return localRate(key, Date.now()); throw new Error('store unavailable'); }
export async function recordEvent({ type, pageId, themeId, eventId, date }) {
  if (hasRedis()) {
    const script = `if redis.call('SET', KEYS[5] .. ARGV[1], '1', 'NX', 'EX', 172800) == false then return 0 end; redis.call('SADD', KEYS[6], ARGV[2]); redis.call('SETNX', KEYS[7], ARGV[6]); redis.call('SET', KEYS[8], ARGV[6]); if ARGV[3] == 'page_view' then redis.call('HINCRBY', KEYS[1], 'pageViews', 1); redis.call('HINCRBY', KEYS[2], 'pageViews', 1); redis.call('HINCRBY', KEYS[3], ARGV[4], 1) else redis.call('HINCRBY', KEYS[1], 'themeStarts', 1); redis.call('HINCRBY', KEYS[2], 'themeStarts', 1); redis.call('HINCRBY', KEYS[4], ARGV[5], 1) end; return 1`;
    const day = `${REDIS_PREFIX}:day:${date}`, totals = `${REDIS_PREFIX}:totals`, pages = `${REDIS_PREFIX}:pages:${date}`, themes = `${REDIS_PREFIX}:themes:${date}`, dedup = `${REDIS_PREFIX}:dedup:`, dates = `${REDIS_PREFIX}:dates`, started = `${REDIS_PREFIX}:startedAt`, updated = `${REDIS_PREFIX}:updatedAt`;
    const now = new Date().toISOString();
    return Number(await redisCommand(['EVAL', script, 8, day, totals, pages, themes, dedup, dates, started, updated, eventId, date, type, pageId || '', themeId || '', now]));
  }
  if (!localEnabled) throw new Error('store unavailable');
  const db = readLocal(); const d = dayData(db, date); db.dates ||= {}; if (db.dedup[eventId]) return 0; db.dedup[eventId] = Date.now() + 172800000; db.dates[date] = true;
  d.pageViews += type === 'page_view' ? 1 : 0; d.themeStarts += type === 'theme_start' ? 1 : 0; db.totals ||= { pageViews: 0, themeStarts: 0, pages: {}, themes: {} }; db.totals.pageViews += type === 'page_view' ? 1 : 0; db.totals.themeStarts += type === 'theme_start' ? 1 : 0;
  if (type === 'page_view') d.pages[pageId] = (d.pages[pageId] || 0) + 1, db.totals.pages[pageId] = (db.totals.pages[pageId] || 0) + 1;
  if (type === 'theme_start') d.themes[themeId] = (d.themes[themeId] || 0) + 1, db.totals.themes[themeId] = (db.totals.themes[themeId] || 0) + 1;
  db.startedAt ||= new Date().toISOString(); db.updatedAt = new Date().toISOString(); saveLocal(); return 1;
}
export async function fetchStats(dates) {
  dates = await dates;
  if (hasRedis()) {
    const commands = [['HGETALL', `${REDIS_PREFIX}:totals`], ['GET', `${REDIS_PREFIX}:startedAt`], ['GET', `${REDIS_PREFIX}:updatedAt`]];
    for (const d of dates) commands.push(['HGETALL', `${REDIS_PREFIX}:day:${d}`], ['HGETALL', `${REDIS_PREFIX}:pages:${d}`], ['HGETALL', `${REDIS_PREFIX}:themes:${d}`]);
    const out = await redisPipeline(commands); return { totals: hash(out[0]), startedAt: out[1], updatedAt: out[2], days: dates.map((date, i) => ({ date, day: hash(out[3 + i * 3]), pages: hash(out[4 + i * 3]), themes: hash(out[5 + i * 3]) })) };
  }
  if (!localEnabled) throw new Error('store unavailable'); const db = readLocal(); return { totals: db.totals || {}, days: dates.map((date) => ({ date, day: db.days[date] || {}, pages: db.days[date]?.pages || {}, themes: db.days[date]?.themes || {} })), startedAt: db.startedAt, updatedAt: db.updatedAt };
}
export async function knownDates() { if (hasRedis()) return (await redisCommand(['SMEMBERS', `${REDIS_PREFIX}:dates`])).sort(); if (!localEnabled) throw new Error('store unavailable'); return Object.keys(readLocal().dates || {}).sort(); }
function hash(value) { const o = {}; for (let i = 0; i < (value || []).length; i += 2) o[value[i]] = Number(value[i + 1]); return o; }
