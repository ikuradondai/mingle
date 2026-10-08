const KEY = 'mingle.cards.minority-auth-return.v1';
const TTL = 30 * 60 * 1000;
const tokenOk = (value) => value === undefined || value === '' || (typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value));
export function saveMinorityAuthIntent({ venueToken, name } = {}, storage = globalThis.sessionStorage, now = Date.now) {
  if (!storage) return false;
  const createdAt = now();
  if (!tokenOk(venueToken) || typeof name !== 'string' || Array.from(name).length > 40) return false;
  try { storage.setItem(KEY, JSON.stringify({ createdAt, expiresAt: createdAt + TTL, venueToken: venueToken || '', name: name.trim() })); return true; } catch { return false; }
}
export function consumeMinorityAuthIntent(storage = globalThis.sessionStorage, now = Date.now) {
  if (!storage) return null;
  try { const value = JSON.parse(storage.getItem(KEY) || 'null'); storage.removeItem(KEY); if (!value || !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt) || value.createdAt > now() || value.expiresAt < now() || value.expiresAt - value.createdAt > TTL || !tokenOk(value.venueToken) || typeof value.name !== 'string') return null; return { venueToken: value.venueToken || '', name: value.name }; } catch { return null; }
}
export function clearMinorityAuthIntent(storage = globalThis.sessionStorage) { try { storage?.removeItem(KEY); } catch {} }
export const minorityAuthIntentKey = KEY;
