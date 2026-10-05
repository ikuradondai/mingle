import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { accountConfig, ACCOUNT_ERRORS } from './accounts.mjs';
import { requireAdultConfirmed } from './age-confirmation.mjs';

const CATEGORIES = new Set(['self','relationship','friends','family','work','sports','first-meeting','roleplay','adult']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CARDS = new Map([...decks, ...soloDecks].flatMap((d) => [...(d.questions || []), ...(d.r18Questions || [])].map((q) => [typeof q === 'string' ? q : q.id, { id: typeof q === 'string' ? q : q.id, text: typeof q === 'string' ? q : q.text, r18: Boolean(d.adultOnly || (typeof q === 'object' && q.r18)), kind: 'question' }])));
const fail = (status, code) => Object.assign(new Error(code), { status, code });
function auth(req) { const value = req.headers?.authorization || ''; return /^Bearer\s+\S+$/i.test(value) ? value : ''; }
async function fetchJson(config, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}${path}`, { ...options, headers: { apikey: config.key, Authorization: options.headers?.Authorization || `Bearer ${config.key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = null; try { data = await response.json(); } catch {}
  if (!response.ok) {
    const code = data?.code || data?.error || data?.message || ''; const detail = `${code} ${data?.message || ''}`;
    if (response.status === 401) throw fail(401, ACCOUNT_ERRORS.auth);
    if (response.status === 404 && /PGRST202|PGRST205|42883|function .* does not exist/i.test(String(code))) throw fail(503, ACCOUNT_ERRORS.unavailable);
    if (/P0002|NOT_FOUND|SOURCE_SET_NOT_FOUND|MARKETPLACE_NOT_FOUND/i.test(detail)) throw fail(404, 'NOT_FOUND');
    if (/AGE_CONFIRMATION_REQUIRED|ADULT_DISPLAY_REQUIRED|ADULT_ATTESTATION_REQUIRED|42501/i.test(detail)) throw fail(403, 'AGE_CONFIRMATION_REQUIRED');
    if (/SOURCE_CARDS_CHANGED|40001/i.test(detail)) throw fail(409, 'SOURCE_CARDS_CHANGED');
    if (/22023|INVALID_|CARD_SNAPSHOT_INVALID/i.test(detail)) throw fail(400, ACCOUNT_ERRORS.invalid);
    throw fail(502, ACCOUNT_ERRORS.unavailable);
  }
  return data;
}
function text(value, max) { if (typeof value !== 'string' || value.trim().length < 1 || Array.from(value.trim()).length > max || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) throw fail(400, ACCOUNT_ERRORS.invalid); return value.trim(); }
function inputMeta(body) {
  if (!body || typeof body !== 'object' || !CATEGORIES.has(body.category) || !['group','solo','both'].includes(body.audience) || !['shuffle','fixed'].includes(body.questionOrder)) throw fail(400, ACCOUNT_ERRORS.invalid);
  return { name: text(body.name, 80), description: body.description == null || body.description === '' ? '' : text(body.description, 500), category: body.category, publisherName: body.publisherName === '匿名' ? '匿名' : text(body.publisherName, 40), audience: body.audience, questionOrder: body.questionOrder };
}

export function createMarketplaceService({ env = process.env, fetchImpl = fetch } = {}) {
  const config = accountConfig(env);
  async function requireUser(req) {
    if (!config) throw fail(503, ACCOUNT_ERRORS.unavailable);
    const authorization = auth(req); if (!authorization) throw fail(401, ACCOUNT_ERRORS.auth);
    const user = await fetchJson(config, '/auth/v1/user', { headers: { Authorization: authorization } }, fetchImpl);
    if (!user?.id || !UUID.test(user.id)) throw fail(401, ACCOUNT_ERRORS.auth);
    return { user, authorization };
  }
  async function rpc(name, args, authorization) {
    if (!config.serviceKey) throw fail(503, ACCOUNT_ERRORS.unavailable);
    return fetchJson(config, `/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args), headers: { Authorization: `Bearer ${config.serviceKey || config.key}` } }, fetchImpl);
  }
  async function adultAllowed(user, authorization, requested) {
    if (!requested) throw fail(403, 'ADULT_DISPLAY_REQUIRED');
    if (!config) throw fail(503, ACCOUNT_ERRORS.unavailable);
    try { await requireAdultConfirmed({ config, userId: user.id, authorization, fetchImpl }); } catch { throw fail(403, 'ADULT_CONFIRMATION_REQUIRED'); }
    return true;
  }
  async function sourceSnapshot(user, authorization, setId) {
    if (typeof setId !== 'string' || !UUID.test(setId)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const rows = await fetchJson(config, `/rest/v1/my_sets?id=eq.${encodeURIComponent(setId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,name,card_ids,audience,question_order`, { headers: { Authorization: authorization } }, fetchImpl);
    const set = rows?.[0]; if (!set || !Array.isArray(set.card_ids) || set.card_ids.length < 6 || set.card_ids.length > 40) throw fail(404, 'NOT_FOUND');
    const customIds = set.card_ids.filter((id) => typeof id === 'string' && id.startsWith('custom:') && UUID.test(id.slice(7)));
    const custom = customIds.length ? await fetchJson(config, `/rest/v1/custom_cards?id=in.(${customIds.map((x) => encodeURIComponent(x.slice(7))).join(',')})&user_id=eq.${encodeURIComponent(user.id)}&select=id,text,r18`, { headers: { Authorization: authorization } }, fetchImpl) : [];
    const customMap = new Map((custom || []).map((c) => [`custom:${c.id}`, { id: `custom:${c.id}`, text: c.text, r18: Boolean(c.r18), kind: 'custom' }]));
    const cards = set.card_ids.map((id) => customMap.get(id) || CARDS.get(id));
    if (cards.some((c) => !c)) throw fail(400, ACCOUNT_ERRORS.invalid);
    return { set, cards, adultOnly: cards.some((c) => c.r18) };
  }
  async function list(req) {
    if (!config) throw fail(503, ACCOUNT_ERRORS.unavailable);
    const url = new URL(req.url || '/', 'http://localhost'); const rawLimit = Number(url.searchParams.get('limit') || 20); const rawOffset = Number(url.searchParams.get('offset') || 0); if (!Number.isInteger(rawLimit) || !Number.isInteger(rawOffset) || rawLimit < 0 || rawOffset < 0) throw fail(400, ACCOUNT_ERRORS.invalid); const limit = Math.min(24, Math.max(1, rawLimit || 20)); const offset = rawOffset;
    if (!config.serviceKey) throw fail(503, ACCOUNT_ERRORS.unavailable);
    let userId = ''; let allowAdult = false;
    if (auth(req)) { const { user, authorization } = await requireUser(req); userId = user.id; if (url.searchParams.get('showR18') === 'true') allowAdult = await adultAllowed(user, authorization, true); }
    const q = new URLSearchParams({ p_limit: String(limit), p_offset: String(offset), p_search: url.searchParams.get('search') || '', p_allow_adult: String(allowAdult) });
    if (userId) q.set('p_user_id', userId);
    if (url.searchParams.get('category')) q.set('p_category', url.searchParams.get('category'));
    if (url.searchParams.get('audience')) q.set('p_audience', url.searchParams.get('audience'));
    const rows = await fetchJson(config, `/rest/v1/rpc/marketplace_list?${q}`, { headers: { Authorization: `Bearer ${config.serviceKey}` } }, fetchImpl);
    return { items: Array.isArray(rows) ? rows : [], limit, offset };
  }
  async function publish(req) {
    if (!config?.serviceKey) throw fail(503, ACCOUNT_ERRORS.unavailable);
    const { user, authorization } = await requireUser(req); const body = req.body || {}; const meta = inputMeta(body); const source = await sourceSnapshot(user, authorization, body.setId); const adult = source.adultOnly; if (meta.audience !== source.set.audience || meta.questionOrder !== source.set.question_order || (meta.category === 'adult' && !adult)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const allowAdult = adult ? await adultAllowed(user, authorization, body.showR18 === true) : false;
    const result = await rpc('marketplace_publish', { p_user_id: user.id, p_set_id: source.set.id, p_name: meta.name, p_description: meta.description, p_category: meta.category, p_publisher_name: meta.publisherName, p_audience: meta.audience, p_question_order: meta.questionOrder, p_adult_only: adult, p_allow_adult: allowAdult, p_cards: source.cards }, authorization);
    return Array.isArray(result) ? result[0] : result;
  }
  async function importSet(req) {
    if (!config?.serviceKey) throw fail(503, ACCOUNT_ERRORS.unavailable);
    const { user, authorization } = await requireUser(req); const id = req.body?.listingId; if (typeof id !== 'string' || !UUID.test(id)) throw fail(400, ACCOUNT_ERRORS.invalid);
    const allowAdult = req.body?.showR18 === true ? await adultAllowed(user, authorization, true) : false;
    const result = await rpc('marketplace_import', { p_user_id: user.id, p_listing_id: id, p_allow_adult: allowAdult }, authorization); return Array.isArray(result) ? result[0] : result;
  }
  async function like(req) {
    if (!config?.serviceKey) throw fail(503, ACCOUNT_ERRORS.unavailable);
    const { user, authorization } = await requireUser(req); const id = req.body?.listingId; if (typeof id !== 'string' || !UUID.test(id) || typeof req.body?.liked !== 'boolean') throw fail(400, ACCOUNT_ERRORS.invalid);
    const allowAdult = req.body.showR18 === true ? await adultAllowed(user, authorization, true) : false;
    const result = await rpc('marketplace_like', { p_user_id: user.id, p_listing_id: id, p_like: req.body.liked, p_allow_adult: allowAdult }, authorization); return Array.isArray(result) ? result[0] : result;
  }
  async function detail(req, id) {
    if (!UUID.test(id)) throw fail(404, 'NOT_FOUND');
    if (!config) throw fail(503, ACCOUNT_ERRORS.unavailable);
    if (!config.serviceKey) throw fail(503, ACCOUNT_ERRORS.unavailable);
    const url = new URL(req.url || '/', 'http://localhost'); let allowAdult = false; let userId = ''; if (auth(req)) { const { user, authorization } = await requireUser(req); userId = user.id; if (url.searchParams.get('showR18') === 'true') allowAdult = await adultAllowed(user, authorization, true); }
    const params = new URLSearchParams({ p_listing_id: id, p_allow_adult: String(allowAdult) }); if (userId) params.set('p_user_id', userId);
    const result = await fetchJson(config, `/rest/v1/rpc/marketplace_detail?${params}`, { headers: { Authorization: `Bearer ${config.serviceKey}` } }, fetchImpl); const value = Array.isArray(result) ? result[0] || null : result; if (!value) throw fail(404, 'NOT_FOUND'); return value;
  }
  async function ownerList(req) {
    const { user, authorization } = await requireUser(req); if (!config.serviceKey) throw fail(503, ACCOUNT_ERRORS.unavailable); const url = new URL(req.url || '/', 'http://localhost'); let allowAdult = false; if (url.searchParams.get('showR18') === 'true') { await adultAllowed(user, authorization, true); allowAdult = true; }
    const result = await fetchJson(config, `/rest/v1/rpc/marketplace_owner_list?p_user_id=${encodeURIComponent(user.id)}&p_allow_adult=${allowAdult}`, { headers: { Authorization: `Bearer ${config.serviceKey}` } }, fetchImpl);
    return { items: Array.isArray(result) ? result : [] };
  }
  async function withdraw(req) { const { user } = await requireUser(req); const id = req.body?.listingId; if (typeof id !== 'string' || !UUID.test(id)) throw fail(400, ACCOUNT_ERRORS.invalid); const result = await rpc('marketplace_withdraw', { p_user_id: user.id, p_listing_id: id }); return Array.isArray(result) ? result[0] : result; }
  return { config, list, detail, ownerList, publish, importSet, like, withdraw };
}
