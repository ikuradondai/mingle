import { clearOtherGameAuthIntents } from './game-auth-intent-keys.js';
const KEY = 'mingle.cards.quick-quiz-auth-return.v1';
const SETUP_KEY = 'mingle.cards.quick-quiz-setup.v1';
const TTL = 30 * 60 * 1000;
const LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'expert']);
function safeStorage() { try { return globalThis.sessionStorage; } catch { return null; } }
function validToken(value) { return value === '' || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)); }
function normalizeParticipants(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) return [];
  const names = value.map((name) => typeof name === 'string' ? name.trim() : '').filter((name) => name && Array.from(name).length <= 40 && !/[\u0000-\u001f\u007f]/u.test(name));
  return names.length === value.length ? names : [];
}
export function saveQuickQuizAuthIntent({ venueToken = '', name = '', difficulty = 'beginner', participants = [] } = {}, storage = safeStorage()) {
  if (!Array.isArray(participants)) return false;
  const roster = normalizeParticipants(participants);
  if (!storage || typeof name !== 'string' || Array.from(name).length > 40 || !validToken(venueToken) || !LEVELS.has(difficulty) || (participants.length > 0 && !roster.length)) return false;
  const createdAt = Date.now();
  clearOtherGameAuthIntents('quickQuiz', storage);
  try { storage.setItem(KEY, JSON.stringify({ createdAt, expiresAt: createdAt + TTL, venueToken, name: name.trim(), difficulty, participants: roster })); return true; } catch { return false; }
}
export function saveQuickQuizSetupIntent({ venueToken = '', name = '', participants = [], difficulty = 'beginner' } = {}, storage = safeStorage()) {
  const roster = normalizeParticipants(participants);
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!storage || !Array.isArray(participants) || (!roster.length && (!normalizedName || Array.from(normalizedName).length > 40 || /[\u0000-\u001f\u007f]/u.test(normalizedName))) || !validToken(venueToken) || !LEVELS.has(difficulty)) return false;
  const createdAt = Date.now();
  try { storage.setItem(SETUP_KEY, JSON.stringify({ createdAt, expiresAt: createdAt + TTL, venueToken, name: normalizedName || roster[0], participants: roster, difficulty })); return true; } catch { return false; }
}
export function consumeQuickQuizSetupIntent(storage = safeStorage(), now = Date.now(), expectedVenueToken = null) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(SETUP_KEY) || 'null'); storage.removeItem(SETUP_KEY);
    const roster = normalizeParticipants(value?.participants);
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    if (!value || !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt) || value.createdAt > now || value.expiresAt < now || value.expiresAt - value.createdAt > TTL || !validToken(value.venueToken) || (expectedVenueToken !== null && value.venueToken !== expectedVenueToken) || (!roster.length && (!name || Array.from(name).length > 40 || /[\u0000-\u001f\u007f]/u.test(name))) || !LEVELS.has(value.difficulty)) return null;
    return { venueToken: value.venueToken || '', name: name || roster[0], participants: roster, difficulty: value.difficulty };
  } catch { return null; }
}
export function consumeQuickQuizAuthIntent(storage = safeStorage(), now = Date.now()) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(KEY) || 'null'); storage.removeItem(KEY);
    const roster = normalizeParticipants(value.participants);
    if (!value || !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt) || value.createdAt > now || value.expiresAt < now || value.expiresAt - value.createdAt > TTL || !validToken(value.venueToken) || typeof value.name !== 'string' || Array.from(value.name).length > 40 || !LEVELS.has(value.difficulty) || (value.participants !== undefined && (!Array.isArray(value.participants) || (value.participants.length > 0 && !roster.length)))) return null;
    return { venueToken: value.venueToken || '', name: value.name, difficulty: value.difficulty, participants: roster };
  } catch { return null; }
}
