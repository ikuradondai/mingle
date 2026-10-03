export const PAGE_IDS = ['participants', 'decks', 'play'];
export const PAGE_LABELS = { participants: 'トップ（参加者入力）', decks: '質問テーマ選択', play: 'カード' };
import { decks } from '../dist/data/decks.js';
export const ALLOWED_THEME_IDS = [...decks.map((deck) => deck.id), 'mix', 'my-set', 'shared-set'];
export const THEME_LABELS = Object.fromEntries([...decks.map((deck) => [deck.id, deck.title]), ['mix', 'テーマミックス'], ['my-set', 'マイセット'], ['shared-set', '共有セット']]);
export const SESSION_COOKIE = 'mingle_admin';
export const SESSION_TTL_SECONDS = 60 * 60 * 4;
export const MAX_BODY_BYTES = 2048;
const namespace = process.env.ANALYTICS_NAMESPACE || (process.env.VERCEL_ENV === 'production' ? 'prod' : process.env.VERCEL_ENV || 'local');
export const REDIS_PREFIX = `mingle:analytics:v1:${namespace}`;
export function isProduction() { return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL); }
export function redisUrl() { return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL; }
export function redisToken() { return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN; }
export function hasRedis() { return Boolean(redisUrl() && redisToken()); }
