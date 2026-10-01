import { hasRedis, redisToken, redisUrl } from './config.mjs';

export async function redisPipeline(commands) {
  if (!hasRedis()) throw new Error('persistent analytics store is not configured');
  const base = redisUrl().replace(/\/$/, '');
  const response = await fetch(base.endsWith('/pipeline') ? base : `${base}/pipeline`, {
    method: 'POST', headers: { Authorization: `Bearer ${redisToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`redis ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result) || result.some((item) => item?.error)) throw new Error('redis command failed');
  return result.map((item) => item?.result);
}
export async function redisCommand(command) { return (await redisPipeline([command]))[0]; }
