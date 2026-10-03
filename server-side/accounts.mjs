import { decks } from '../dist/data/decks.js';
import { createHash, randomBytes } from 'node:crypto';

const MAX_NAME = 80;
const MAX_CARDS = 40;
const MIN_CARDS = 6;
const CARD_IDS = new Set(decks.flatMap((deck) => [...(deck.questions || []), ...(deck.r18Questions || [])].map((card) => typeof card === 'string' ? card : card.id)));
const CUSTOM_ID = /^custom:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const CUSTOM_TEXT_MAX = 300;
const SHARE_TOKEN_BYTES = 32;
const AVATAR_BUCKET = 'profile-avatars';
const AVATAR_PATH = (userId) => `${userId}/avatar.jpg`;
const AVATAR_MAX_BYTES = 256 * 1024;

export const ACCOUNT_ERRORS = {
  unavailable: 'FEATURE_UNAVAILABLE',
  auth: 'UNAUTHENTICATED',
  invalid: 'INVALID_REQUEST',
  forbidden: 'FORBIDDEN',
  conflict: 'CARD_IN_USE',
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
const STATIC_CARDS = new Map(decks.flatMap((deck) => [...(deck.questions || []), ...(deck.r18Questions || [])].map((card) => [card.id, { id: card.id, text: card.text, r18: Boolean(card.r18 || deck.adultOnly), kind: card.kind || 'question' }])));
function displayName(value) { return typeof value === 'string' ? value.trim() : ''; }
function userDisplayName(user) { return displayName(user?.user_metadata?.display_name) || null; }

function fail(status, code, message) { const error = new Error(message || code); error.status = status; error.code = code; return error; }
function authHeader(req) { const raw = req.headers?.authorization || ''; return /^Bearer\s+\S+$/i.test(raw) ? raw : ''; }
async function supabaseFetch(config, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}${path}`, { ...options, headers: { apikey: config.key, Authorization: options.headers?.Authorization || `Bearer ${config.key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = null; try { data = await response.json(); } catch { /* empty */ }
  if (!response.ok) {
    const raw = JSON.stringify(data || '');
    if (/CARD_IN_USE/i.test(raw)) { const error = fail(409, ACCOUNT_ERRORS.conflict); error.remote = data; throw error; }
    const error = fail(response.status === 401 ? 401 : (response.status === 404 ? 404 : 502), response.status === 401 ? ACCOUNT_ERRORS.auth : ACCOUNT_ERRORS.unavailable, 'Supabase request failed'); error.remote = data; throw error;
  }
  return data;
}


  async function storageFetch(config, path, options = {}, authorization, fetchImpl = fetch) {
    const response = await fetchImpl(`${config.url}${path}`, { ...options, headers: { apikey: config.key, Authorization: authorization, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    let data = null; try { data = await response.json(); } catch { /* empty */ }
    if (!response.ok) { const storageMissing = response.status === 404 || data?.statusCode === 404 || data?.statusCode === '404'; const error = fail(storageMissing ? 404 : 502, storageMissing ? 'NOT_FOUND' : ACCOUNT_ERRORS.unavailable, 'Storage request failed'); error.remote = data; throw error; }
    return data;
  }
  function storagePath(path) { return String(path).split('/').map((part) => encodeURIComponent(part)).join('/'); }
  function storageUrl(value, config) { if (typeof value !== 'string' || !value) return null; return /^https?:\/\//i.test(value) ? value : `${config.url}/storage/v1${value.startsWith('/') ? value : `/${value}`}`; }
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
  function customId(uuid) { return `custom:${uuid}`; }
  function shareHash(token) { return createHash('sha256').update(token).digest('hex'); }
  function shareToken() { return randomBytes(SHARE_TOKEN_BYTES).toString('base64url'); }
  function customUuid(value) { const match = typeof value === 'string' && value.match(CUSTOM_ID); return match?.[1] || null; }
  function customText(value) {
    if (typeof value !== 'string') throw fail(400, ACCOUNT_ERRORS.invalid);
    if (/\r|\n|[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const text = value.trim();
    if (!text || Array.from(text).length > CUSTOM_TEXT_MAX) throw fail(400, ACCOUNT_ERRORS.invalid);
    return text;
  }
  function customInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || typeof input.r18 !== 'boolean') throw fail(400, ACCOUNT_ERRORS.invalid);
    return { text: customText(input.text), r18: input.r18 };
  }
  function mapCustom(row) { return { id: customId(row.id), text: row.text, r18: Boolean(row.r18), createdAt: row.created_at, updatedAt: row.updated_at }; }
  function missingCustomTable(error) {
    if (error?.status !== 404) return false;
    const remote = error.remote || {};
    const code = remote.code;
    return (code === 'PGRST205' || code === '42P01') && /custom_cards/i.test(JSON.stringify(remote));
  }
  async function customRows(userId, authorization) { return rows('custom_cards', userId, authorization, '&select=id,text,r18,created_at,updated_at&order=created_at.asc'); }
  async function ownerCardIds(userId, authorization) { return new Set((await customRows(userId, authorization)).map((row) => customId(row.id))); }
  async function validateCardsForUser(value, userId, authorization) {
    if (!Array.isArray(value) || value.length < MIN_CARDS || value.length > MAX_CARDS || new Set(value).size !== value.length || value.some((id) => typeof id !== 'string')) throw fail(400, ACCOUNT_ERRORS.invalid);
    const custom = value.filter((id) => id.startsWith('custom:'));
    if (value.some((id) => !id.startsWith('custom:') && !validCardId(id)) || custom.some((id) => !customUuid(id))) throw fail(400, ACCOUNT_ERRORS.invalid);
    if (custom.length) {
      let owned; try { owned = await ownerCardIds(userId, authorization); } catch (error) { if (missingCustomTable(error)) throw fail(503, ACCOUNT_ERRORS.unavailable); throw error; }
      if (custom.some((id) => !owned.has(id))) throw fail(403, ACCOUNT_ERRORS.forbidden);
    }
    return value;
  }
  async function account(req) {
    const { user, authorization } = await requireUser(req);
    const [favorites, sets] = await Promise.all([rows('favorites', user.id, authorization, '&select=card_id,created_at&order=created_at.desc'), rows('my_sets', user.id, authorization, '&select=id,name,card_ids,created_at,updated_at&order=created_at.asc')]);
    let customCards = []; let customCardsAvailable = true;
    try { customCards = (await customRows(user.id, authorization)).map(mapCustom); } catch (error) { if (missingCustomTable(error)) customCardsAvailable = false; else throw error; }
    let avatarUrlValue = null; try { avatarUrlValue = await avatarUrl(user.id, authorization); } catch { /* Storage may not be configured; account data remains available. */ }
    return { user: { id: user.id, email: user.email || null, displayName: userDisplayName(user), avatarUrl: avatarUrlValue }, account: { deletionAvailable: Boolean(config.serviceKey) }, favorites, sets, customCards, customCardsAvailable };
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
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > MAX_NAME) throw fail(400, ACCOUNT_ERRORS.invalid);
      await validateCardsForUser(input.cardIds, user.id, authorization);
      const created = await supabaseFetch(config, '/rest/v1/my_sets', { method: 'POST', body: JSON.stringify({ user_id: user.id, name: input.name.trim(), card_ids: input.cardIds }), headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
      return Array.isArray(created) ? created[0] : created;
    }
    if (!setId || !/^[0-9a-f-]{16,64}$/i.test(setId)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const path = `/rest/v1/my_sets?id=eq.${encodeURIComponent(setId)}&user_id=eq.${encodeURIComponent(user.id)}`;
    if (req.method === 'DELETE') { await supabaseFetch(config, path, { method: 'DELETE', headers: { Authorization: authorization } }, fetchImpl); return { deleted: true, id: setId }; }
    if (req.method !== 'PATCH') throw fail(405, 'METHOD_NOT_ALLOWED');
    const input = req.body || {}; const update = {};
    if (Object.prototype.hasOwnProperty.call(input, 'name')) { if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > MAX_NAME) throw fail(400, ACCOUNT_ERRORS.invalid); update.name = input.name.trim(); }
    if (Object.prototype.hasOwnProperty.call(input, 'cardIds')) { await validateCardsForUser(input.cardIds, user.id, authorization); update.card_ids = input.cardIds; }
    if (!Object.keys(update).length) throw fail(400, ACCOUNT_ERRORS.invalid);
    const updated = await supabaseFetch(config, path, { method: 'PATCH', body: JSON.stringify(update), headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
    const result = Array.isArray(updated) ? updated[0] : updated;
    if (!result) throw fail(404, 'NOT_FOUND');
    return result;
  }
  async function customCard(req, cardId = '') {
    const { user, authorization } = await requireUser(req);
    if (req.method === 'POST' && !cardId) {
      const input = customInput(req.body);
      const created = await supabaseFetch(config, '/rest/v1/custom_cards', { method: 'POST', body: JSON.stringify({ user_id: user.id, text: input.text, r18: input.r18 }), headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
      return { card: mapCustom(Array.isArray(created) ? created[0] : created) };
    }
    const uuid = customUuid(cardId); if (!uuid) throw fail(400, ACCOUNT_ERRORS.invalid);
    const path = `/rest/v1/custom_cards?id=eq.${encodeURIComponent(uuid)}&user_id=eq.${encodeURIComponent(user.id)}`;
    if (req.method === 'PATCH') {
      const input = customInput(req.body);
      const updated = await supabaseFetch(config, path, { method: 'PATCH', body: JSON.stringify({ text: input.text, r18: input.r18 }), headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
      const row = Array.isArray(updated) ? updated[0] : updated; if (!row) throw fail(404, 'NOT_FOUND'); return { card: mapCustom(row) };
    }
    if (req.method === 'DELETE') {
      const sets = await rows('my_sets', user.id, authorization, '&select=card_ids');
      if (sets.some((set) => Array.isArray(set.card_ids) && set.card_ids.includes(customId(uuid)))) throw fail(409, ACCOUNT_ERRORS.conflict);
      const deleted = await supabaseFetch(config, path, { method: 'DELETE', headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
      if (!Array.isArray(deleted) ? !deleted : !deleted.length) throw fail(404, 'NOT_FOUND');
      return { deleted: true, id: customId(uuid) };
    }
    throw fail(405, 'METHOD_NOT_ALLOWED');
  }
  async function snapshotForSet(set, userId, authorization) {
    const cards = [];
    let custom = new Map();
    try { custom = new Map((await customRows(userId, authorization)).map((row) => [customId(row.id), mapCustom(row)])); } catch (error) { if (!missingCustomTable(error)) throw error; }
    for (const id of set.card_ids || []) {
      const card = id.startsWith('custom:') ? custom.get(id) : STATIC_CARDS.get(id);
      if (!card) throw fail(403, ACCOUNT_ERRORS.forbidden);
      cards.push({ id: card.id, text: card.text, r18: Boolean(card.r18), kind: card.kind || 'question' });
    }
    return { name: set.name, cardCount: cards.length, adultOnly: cards.some((card) => card.r18), cards };
  }
  async function shareSet(req, setId = '') {
    const { user, authorization } = await requireUser(req);
    if (!/^[0-9a-f-]{16,64}$/i.test(setId)) throw fail(400, ACCOUNT_ERRORS.invalid);
    if (!['GET', 'POST', 'PUT'].includes(req.method)) throw fail(405, 'METHOD_NOT_ALLOWED');
    const sets = await rows('my_sets', user.id, authorization, `&id=eq.${encodeURIComponent(setId)}&select=id,name,card_ids`);
    if (!sets.length) throw fail(404, 'NOT_FOUND');
    const current = async () => {
      const rowsFound = await supabaseFetch(config, `/rest/v1/shared_sets?owner_id=eq.${encodeURIComponent(user.id)}&set_id=eq.${encodeURIComponent(setId)}&revoked_at=is.null&select=id,token,name,card_count,adult_only&limit=1`, { headers: { Authorization: authorization } }, fetchImpl);
      const row = Array.isArray(rowsFound) ? rowsFound[0] : null;
      return row ? { share: { token: row.token, url: `/?share=${encodeURIComponent(row.token)}`, name: row.name, cardCount: row.card_count, adultOnly: Boolean(row.adult_only), id: row.id || null } } : { share: null };
    };
    if (req.method === 'GET') return current();
    const snapshot = await snapshotForSet(sets[0], user.id, authorization);
    const token = shareToken();
    const created = await supabaseFetch(config, '/rest/v1/rpc/create_shared_set', { method: 'POST', body: JSON.stringify({ p_set_id: setId, p_token: token, p_token_hash: shareHash(token), p_name: snapshot.name, p_card_count: snapshot.cardCount, p_adult_only: snapshot.adultOnly, p_cards: snapshot.cards, p_rotate: req.method === 'PUT' }), headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
    const row = Array.isArray(created) ? created[0] : created;
    if (!row?.token) throw fail(502, ACCOUNT_ERRORS.unavailable);
    return { share: { token: row.token, url: `/?share=${encodeURIComponent(row.token)}`, name: row.name || snapshot.name, cardCount: row.card_count || snapshot.cardCount, adultOnly: Boolean(row.adult_only ?? snapshot.adultOnly), id: row.id || null } };
  }
  async function stopShare(req, setId = '') {
    const { user, authorization } = await requireUser(req);
    if (!/^[0-9a-f-]{16,64}$/i.test(setId)) throw fail(400, ACCOUNT_ERRORS.invalid);
    await supabaseFetch(config, '/rest/v1/rpc/revoke_shared_set', { method: 'POST', body: JSON.stringify({ p_set_id: setId }), headers: { Authorization: authorization, Prefer: 'return=representation' } }, fetchImpl);
    return { revoked: true, setId };
  }
  async function publicShare(req, token, start = false) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw fail(404, 'NOT_FOUND');
    if (!config?.serviceKey) throw fail(503, 'SHARE_UNAVAILABLE');
    const privateConfig = { ...config, key: config.serviceKey };
    const rowsFound = await supabaseFetch(privateConfig, `/rest/v1/shared_sets?token_hash=eq.${encodeURIComponent(shareHash(token))}&revoked_at=is.null&select=name,card_count,adult_only,cards`, { headers: { Authorization: `Bearer ${config.serviceKey}` } }, fetchImpl);
    const share = Array.isArray(rowsFound) ? rowsFound[0] : null;
    if (!share) throw fail(404, 'NOT_FOUND');
    if (!start) return { share: { name: share.name, cardCount: share.card_count, adultOnly: Boolean(share.adult_only), active: true } };
    const input = req.body || {};
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.participants) || input.participants.length < 2 || input.participants.length > 8 || input.participants.some((value) => typeof value !== 'string' || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value) || !value.trim() || Array.from(value.trim()).length > 40) || Object.keys(input).some((key) => !['participants', 'adultConfirmed'].includes(key)) || typeof input.adultConfirmed !== 'boolean') throw fail(400, ACCOUNT_ERRORS.invalid);
    if (share.adult_only && input.adultConfirmed !== true) throw fail(403, 'ADULT_CONSENT_REQUIRED');
    return { share: { name: share.name, cardCount: share.card_count, adultOnly: Boolean(share.adult_only), active: true }, participants: input.participants.map((value) => value.trim()), cards: Array.isArray(share.cards) ? share.cards : [] };
  }

  function avatarPath(userId) { return AVATAR_PATH(userId); }
  function avatarImage(value) {
    if (typeof value !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const encoded = value.slice('data:image/jpeg;base64,'.length);
    if (!encoded || encoded.length % 4 !== 0) throw fail(400, ACCOUNT_ERRORS.invalid);
    let image; try { image = Buffer.from(encoded, 'base64'); } catch { throw fail(400, ACCOUNT_ERRORS.invalid); }
    if (image.toString('base64') !== encoded) throw fail(400, ACCOUNT_ERRORS.invalid);
    if (!image.length || image.length > AVATAR_MAX_BYTES || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff || image.at(-2) !== 0xff || image.at(-1) !== 0xd9) throw fail(400, ACCOUNT_ERRORS.invalid);
    return image;
  }
  function avatarCacheBust(url) { if (!url) return null; return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now().toString(36)}`; }
  async function avatarUrl(userId, authorization) {
    try {
      const result = await storageFetch(config, `/storage/v1/object/sign/${AVATAR_BUCKET}/${storagePath(avatarPath(userId))}`, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) }, authorization, fetchImpl);
      return avatarCacheBust(storageUrl(result?.signedURL || result?.signedUrl || result?.url, config));
    } catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function avatar(req) {
    const { user, authorization } = await requireUser(req);
    const path = avatarPath(user.id);
    if (req.method === 'GET') { try { return { avatarUrl: await avatarUrl(user.id, authorization) }; } catch (error) { if (error.status === 502 || error.status === 404) return { avatarUrl: null }; throw error; } }
    if (req.method === 'PUT') {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !Object.prototype.hasOwnProperty.call(req.body, 'imageData')) throw fail(400, ACCOUNT_ERRORS.invalid);
      const image = avatarImage(req.body.imageData);
      // Supabase Storage's upload/upsert operation is POST; PUT is the SDK's update-only operation.
      await storageFetch(config, `/storage/v1/object/${AVATAR_BUCKET}/${storagePath(path)}`, { method: 'POST', body: image, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store, max-age=0', 'x-upsert': 'true' } }, authorization, fetchImpl);
      return { avatarUrl: await avatarUrl(user.id, authorization) };
    }
    if (req.method === 'DELETE') {
      try { await storageFetch(config, `/storage/v1/object/${AVATAR_BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: [path] }) }, authorization, fetchImpl); } catch (error) { if (error.status !== 404) throw error; }
      return { deleted: true, avatarUrl: null };
    }
    throw fail(405, 'METHOD_NOT_ALLOWED');
  }

  async function removeAccount(req) {
    const { user, authorization } = await requireUser(req);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || req.body.confirmation !== 'DELETE') throw fail(400, 'CONFIRMATION_REQUIRED');
    if (!config.serviceKey) throw fail(503, 'ACCOUNT_DELETION_UNAVAILABLE');
    try { await storageFetch(config, `/storage/v1/object/${AVATAR_BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: [avatarPath(user.id)] }) }, authorization, fetchImpl); } catch (error) { if (error.status !== 404) throw error; }
    await supabaseFetch({ ...config, key: config.serviceKey }, `/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', body: JSON.stringify({ should_soft_delete: false }), headers: { Authorization: `Bearer ${config.serviceKey}` } }, fetchImpl);
    return { deleted: true };
  }
  return { account, profile, avatar, favorite, set, customCard, shareSet, stopShare, publicShare, removeAccount, available: Boolean(config), config: config && { url: config.url, key: config.key, googleEnabled: config.googleEnabled } };
}

export { MAX_NAME, MAX_CARDS, MIN_CARDS, DISPLAY_NAME_MAX, CARD_IDS, CUSTOM_TEXT_MAX };
