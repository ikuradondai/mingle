import { decks } from '../dist/data/decks.js';

const MAX_NAME = 80;
const MAX_CARDS = 40;
const MIN_CARDS = 6;
const CARD_IDS = new Set(decks.flatMap((deck) => [...(deck.questions || []), ...(deck.r18Questions || [])].map((card) => typeof card === 'string' ? card : card.id)));

export const ACCOUNT_ERRORS = {
  unavailable: 'FEATURE_UNAVAILABLE',
  auth: 'UNAUTHENTICATED',
  invalid: 'INVALID_REQUEST',
  forbidden: 'FORBIDDEN',
};

function isPublicKey(key) {
  if (typeof key !== 'string' || /service_role/i.test(key) || /^sb_secret_/i.test(key)) return false;
  if (key.startsWith('sb_publishable_')) return true;
  try { const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); return payload.role === 'anon'; } catch { return false; }
}
export function accountConfig(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let parsed; try { parsed = new URL(url || ''); } catch { return null; }
  const validUrl = (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) && !parsed.username && !parsed.password && (!parsed.pathname || parsed.pathname === '/') && !parsed.search && !parsed.hash;
  return url && isPublicKey(key) && validUrl ? { url: url.replace(/\/$/, ''), key, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '', googleEnabled: env.SUPABASE_GOOGLE_ENABLED === 'true' } : null;
}

export function validCardId(id) { return typeof id === 'string' && CARD_IDS.has(id); }
export function validCards(value) { return Array.isArray(value) && value.length >= MIN_CARDS && value.length <= MAX_CARDS && new Set(value).size === value.length && value.every(validCardId); }
const DISPLAY_NAME_MAX = 40;
function displayName(value) { return typeof value === 'string' ? value.trim() : ''; }
function userDisplayName(user) { return displayName(user?.user_metadata?.display_name) || null; }

function fail(status, code, message) { const error = new Error(message || code); error.status = status; error.code = code; return error; }
function authHeader(req) { const raw = req.headers?.authorization || ''; return /^Bearer\s+\S+$/i.test(raw) ? raw : ''; }
async function supabaseFetch(config, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}${path}`, { ...options, headers: { apikey: config.key, Authorization: options.headers?.Authorization || `Bearer ${config.key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = null; try { data = await response.json(); } catch { /* empty */ }
  if (!response.ok) { const error = fail(response.status === 401 ? 401 : 502, response.status === 401 ? ACCOUNT_ERRORS.auth : ACCOUNT_ERRORS.unavailable, 'Supabase request failed'); error.remote = data; throw error; }
  return data;
}

export function createAccountService({ env = process.env, fetchImpl = fetch } = {}) {
  const config = accountConfig(env);
  async function requireUser(req) {
    if (!config) throw fail(503, ACCOUNT_ERRORS.unavailable);
    const authorization = authHeader(req);
    if (!authorization) throw fail(401, ACCOUNT_ERRORS.auth);
    const user = await supabaseFetch(config, '/auth/v1/user', { headers: { Authorization: authorization } }, fetchImpl);
    if (!user?.id || typeof user.id !== 'string') throw fail(401, ACCOUNT_ERRORS.auth);
    return { user, authorization };
  }
  async function rows(table, userId, authorization, query = '') {
    return supabaseFetch(config, `/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}${query}`, { headers: { Authorization: authorization } }, fetchImpl) || [];
  }
  async function account(req) {
    const { user, authorization } = await requireUser(req);
    const [favorites, sets] = await Promise.all([rows('favorites', user.id, authorization, '&select=card_id,created_at&order=created_at.desc'), rows('my_sets', user.id, authorization, '&select=id,name,card_ids,created_at,updated_at&order=created_at.asc')]);
    return { user: { id: user.id, email: user.email || null, displayName: userDisplayName(user) }, account: { deletionAvailable: Boolean(config.serviceKey) }, favorites, sets };
  }
  async function profile(req) {
    const { user, authorization } = await requireUser(req);
    const input = req.body || {};
    if (Object.keys(input).length !== 1 || !Object.prototype.hasOwnProperty.call(input, 'displayName') || typeof input.displayName !== 'string' || /[\u0000-\u001f\u007f]/u.test(input.displayName)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const value = displayName(input.displayName);
    if (Array.from(value).length > DISPLAY_NAME_MAX) throw fail(400, ACCOUNT_ERRORS.invalid);
    const updated = await supabaseFetch(config, '/auth/v1/user', { method: 'PUT', body: JSON.stringify({ data: { display_name: value } }), headers: { Authorization: authorization } }, fetchImpl);
    return { user: { id: updated?.id || user.id, email: updated?.email || user.email || null, displayName: userDisplayName(updated) ?? (value || null) } };
  }
  async function favorite(req, cardId) {
    const { user, authorization } = await requireUser(req);
    if (!validCardId(cardId)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const existing = await rows('favorites', user.id, authorization, `&card_id=eq.${encodeURIComponent(cardId)}&select=card_id`);
    if (req.method === 'DELETE') {
      if (existing.length) await supabaseFetch(config, `/rest/v1/favorites?user_id=eq.${encodeURIComponent(user.id)}&card_id=eq.${encodeURIComponent(cardId)}`, { method: 'DELETE', headers: { Authorization: authorization } }, fetchImpl);
      return { favorite: false, cardId };
    }
    if (req.method !== 'PUT' && req.method !== 'POST') throw fail(405, 'METHOD_NOT_ALLOWED');
    if (!existing.length) await supabaseFetch(config, '/rest/v1/favorites?on_conflict=user_id,card_id', { method: 'POST', body: JSON.stringify({ user_id: user.id, card_id: cardId }), headers: { Authorization: authorization, Prefer: 'resolution=ignore-duplicates,return=minimal' } }, fetchImpl);
    return { favorite: true, cardId };
  }
  async function set(req, setId = '') {
    const { user, authorization } = await requireUser(req);
    if (req.method === 'POST' && !setId) {
      const input = req.body || {};
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > MAX_NAME || !validCards(input.cardIds)) throw fail(400, ACCOUNT_ERRORS.invalid);
      const created = await supabaseFetch(config, '/rest/v1/my_sets', { method: 'POST', body: JSON.stringify({ user_id: user.id, name: input.name.trim(), card_ids: input.cardIds }), headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
      return Array.isArray(created) ? created[0] : created;
    }
    if (!setId || !/^[0-9a-f-]{16,64}$/i.test(setId)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const path = `/rest/v1/my_sets?id=eq.${encodeURIComponent(setId)}&user_id=eq.${encodeURIComponent(user.id)}`;
    if (req.method === 'DELETE') { await supabaseFetch(config, path, { method: 'DELETE', headers: { Authorization: authorization } }, fetchImpl); return { deleted: true, id: setId }; }
    if (req.method !== 'PATCH') throw fail(405, 'METHOD_NOT_ALLOWED');
    const input = req.body || {}; const update = {};
    if (Object.prototype.hasOwnProperty.call(input, 'name')) { if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > MAX_NAME) throw fail(400, ACCOUNT_ERRORS.invalid); update.name = input.name.trim(); }
    if (Object.prototype.hasOwnProperty.call(input, 'cardIds')) { if (!validCards(input.cardIds)) throw fail(400, ACCOUNT_ERRORS.invalid); update.card_ids = input.cardIds; }
    if (!Object.keys(update).length) throw fail(400, ACCOUNT_ERRORS.invalid);
    const updated = await supabaseFetch(config, path, { method: 'PATCH', body: JSON.stringify(update), headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
    const result = Array.isArray(updated) ? updated[0] : updated;
    if (!result) throw fail(404, 'NOT_FOUND');
    return result;
  }
  async function removeAccount(req) {
    const { user, authorization } = await requireUser(req);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || req.body.confirmation !== 'DELETE') throw fail(400, 'CONFIRMATION_REQUIRED');
    if (!config.serviceKey) throw fail(503, 'ACCOUNT_DELETION_UNAVAILABLE');
    await supabaseFetch({ ...config, key: config.serviceKey }, `/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', body: JSON.stringify({ should_soft_delete: false }), headers: { Authorization: `Bearer ${config.serviceKey}` } }, fetchImpl);
    return { deleted: true };
  }
  return { account, profile, favorite, set, removeAccount, available: Boolean(config), config: config && { url: config.url, key: config.key, googleEnabled: config.googleEnabled } };
}

export { MAX_NAME, MAX_CARDS, MIN_CARDS, DISPLAY_NAME_MAX, CARD_IDS };
