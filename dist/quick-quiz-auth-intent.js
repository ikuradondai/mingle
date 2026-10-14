import { clearOtherGameAuthIntents } from './game-auth-intent-keys.js';
const KEY = 'mingle.cards.quick-quiz-auth-return.v1';
const TTL = 30 * 60 * 1000;
const LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'expert']);
function safeStorage() { try { return globalThis.sessionStorage; } catch { return null; } }
function validToken(value) { return value === '' || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)); }
export function saveQuickQuizAuthIntent({ venueToken = '', name = '', difficulty = 'beginner' } = {}, storage = safeStorage()) {
  if (!storage || typeof name !== 'string' || Array.from(name).length > 40 || !validToken(venueToken) || !LEVELS.has(difficulty)) return false;
  const createdAt = Date.now();
  clearOtherGameAuthIntents('quickQuiz', storage);
  try { storage.setItem(KEY, JSON.stringify({ createdAt, expiresAt: createdAt + TTL, venueToken, name: name.trim(), difficulty })); return true; } catch { return false; }
}
export function consumeQuickQuizAuthIntent(storage = safeStorage(), now = Date.now()) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(KEY) || 'null'); storage.removeItem(KEY);
    if (!value || !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt) || value.createdAt > now || value.expiresAt < now || value.expiresAt - value.createdAt > TTL || !validToken(value.venueToken) || typeof value.name !== 'string' || Array.from(value.name).length > 40 || !LEVELS.has(value.difficulty)) return null;
    return { venueToken: value.venueToken || '', name: value.name, difficulty: value.difficulty };
  } catch { return null; }
}
