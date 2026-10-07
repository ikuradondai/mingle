#!/usr/bin/env node
// Dry-run by default. Run with --apply only from an explicitly approved maintenance window.
const apply = process.argv.includes('--apply');
const cursorOption = process.argv.find((arg) => arg.startsWith('--cursor='));
const batchOption = process.argv.find((arg) => arg.startsWith('--max-batches='));
let cursor = cursorOption ? cursorOption.slice('--cursor='.length) : '0';
const maxBatches = Math.max(1, Math.min(1000, Number(batchOption?.slice('--max-batches='.length) || 100)));
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const namespace = process.env.ANALYTICS_NAMESPACE || (process.env.VERCEL_ENV === 'production' ? 'prod' : process.env.VERCEL_ENV || 'local');
if (!url || !token) throw new Error('Redis configuration is unavailable');
const base = url.replace(/\/$/, '');
async function command(parts) {
  const response = await fetch(`${base}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([parts]) });
  if (!response.ok) throw new Error(`Redis request failed: ${response.status}`);
  const data = await response.json();
  if (data?.[0]?.error) throw new Error('Redis command failed');
  return data?.[0]?.result;
}
const prefix = `mingle:analytics:v1:${namespace}:feedbackDedup:`;
let scanned = 0; let ttlMissing = 0; let batches = 0; let truncated = false;
do {
  const result = await command(['SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', '100']);
  cursor = String(result?.[0] || '0');
  const keys = Array.isArray(result?.[1]) ? result[1] : [];
  scanned += keys.length; batches += 1;
  for (const key of keys) {
    const ttl = Number(await command(['TTL', key]));
    if (ttl === -1) { ttlMissing += 1; if (apply) await command(['EVAL', "if redis.call('TTL', KEYS[1]) == -1 then return redis.call('EXPIRE', KEYS[1], ARGV[1]) else return 0 end", '1', key, '172800']); }
  }
} while (cursor !== '0' && batches < maxBatches);
if (cursor !== '0') truncated = true;
const cutoff = String(Date.now() - 90 * 24 * 60 * 60 * 1000);
const feedbackKey = `mingle:analytics:v1:${namespace}:feedback`;
const stale = Number(await command(['ZCOUNT', feedbackKey, '-inf', cutoff]));
const zcard = Number(await command(['ZCARD', feedbackKey]));
if (apply) await command(['EVAL', "redis.call('EXPIRE', KEYS[1], ARGV[1]); redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2]); local n=redis.call('ZCARD', KEYS[1]); if n > tonumber(ARGV[3]) then redis.call('ZREMRANGEBYRANK', KEYS[1], 0, n-tonumber(ARGV[3])-1) end; return redis.call('ZCARD', KEYS[1])", '1', feedbackKey, String(90 * 24 * 60 * 60), cutoff, '10000']);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', namespace, batches, maxBatches, scanned, ttlMissing, staleSortedSetMembers: stale, sortedSetCount: zcard, truncated, nextCursor: truncated ? cursor : null }));
