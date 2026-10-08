// A short-lived bridge from the main participant form to the one-device games.
// Keep only names and routing context here; answers and game progress stay in memory.
export const SOCIAL_GAME_INTENT_KEY = 'mingle.social-game.intent.v1';
export const SOCIAL_GAME_INTENT_TTL = 30 * 60 * 1000;
const GAME_IDS = new Set(['match', 'choice']);
const VENUE_TOKEN = /^[A-Za-z0-9_-]{32}$/;
const NAME_MAX = 40;

function getStorage(storage) {
  if (storage) return storage;
  try { return globalThis.sessionStorage; } catch { return null; }
}

function validName(value) {
  return typeof value === 'string' && Boolean(value.trim()) && Array.from(value.trim()).length <= NAME_MAX && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validNames(value) {
  return Array.isArray(value) && value.length >= 2 && value.length <= 8 && value.every(validName);
}

function validRoster(gameId, names) {
  return validNames(names) && (gameId !== 'choice' || names.length === 2);
}

function validTime(value, now) {
  return Number.isFinite(value) && value <= now && now - value <= SOCIAL_GAME_INTENT_TTL;
}

export function clearSocialGameIntent(storage) {
  try { getStorage(storage)?.removeItem(SOCIAL_GAME_INTENT_KEY); } catch {}
}

export function saveSocialGameIntent({ gameId, names, venueToken = '' } = {}, storage, now = Date.now) {
  const store = getStorage(storage);
  const createdAt = typeof now === 'function' ? now() : now;
  if (!GAME_IDS.has(gameId) || !validRoster(gameId, names) || !Number.isFinite(createdAt)) return false;
  if (venueToken && !VENUE_TOKEN.test(venueToken)) return false;
  try {
    store?.setItem(SOCIAL_GAME_INTENT_KEY, JSON.stringify({ gameId, names: names.map((name) => name.trim()), venueToken: venueToken || '', createdAt }));
    return Boolean(store);
  } catch { return false; }
}

export function readSocialGameIntent(storage, now = Date.now) {
  const store = getStorage(storage);
  const current = typeof now === 'function' ? now() : now;
  if (!store || !Number.isFinite(current)) return null;
  try {
    const value = JSON.parse(store.getItem(SOCIAL_GAME_INTENT_KEY) || 'null');
    if (!value || !GAME_IDS.has(value.gameId) || !validRoster(value.gameId, value.names) || !validTime(value.createdAt, current) || (value.venueToken && !VENUE_TOKEN.test(value.venueToken))) {
      clearSocialGameIntent(store); return null;
    }
    return { gameId: value.gameId, names: value.names.map((name) => name.trim()), venueToken: value.venueToken || '', createdAt: value.createdAt };
  } catch { clearSocialGameIntent(store); return null; }
}

export function consumeSocialGameIntent(storage, now = Date.now) {
  const value = readSocialGameIntent(storage, now);
  clearSocialGameIntent(storage);
  return value;
}

export function socialGameHomeHref({ venueToken = '', returnToHome = false } = {}) {
  const params = new URLSearchParams();
  if (venueToken && VENUE_TOKEN.test(venueToken)) params.set('venue', venueToken);
  if (returnToHome) params.set('socialGameReturn', '1');
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export const socialGameIds = Object.freeze([...GAME_IDS]);
