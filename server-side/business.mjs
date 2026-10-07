import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { participantCountAllowed, participantRuleForDeck } from '../dist/participant-rule.js';
import { accountConfig } from './accounts.mjs';
import { consumeRate, persistentStoreAvailable } from './store.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const FEATURES = ['group_play', 'solo_play', 'theme_mix', 'audio', 'theme_tags'];
const DEFAULT_FLAGS = { group_play: true, solo_play: true, theme_mix: false, audio: true, theme_tags: true };
const STATIC = new Map([...decks, ...soloDecks].map((deck) => [deck.id, deck]));

const fail = (status, code) => Object.assign(new Error(code), { status, code });
const object = (value) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'INVALID_REQUEST'); return value; };
const auth = (req) => /^Bearer\s+\S+$/i.test(req.headers?.authorization || '') ? req.headers.authorization : '';
const validOrg = (value) => { if (!UUID.test(value)) throw fail(400, 'INVALID_REQUEST'); return value; };
const text = (value, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) throw fail(400, 'INVALID_REQUEST'); return value.trim(); };
const email = (value) => { if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw fail(400, 'INVALID_REQUEST'); return value.trim().toLowerCase(); };

function snapshot(id) {
  const deck = STATIC.get(id);
  if (!deck || deck.adultOnly) return null;
  const rule = participantRuleForDeck(id);
  const cards = (deck.questions || []).filter((card) => !card.r18).map((card) => ({ id: card.id, sourceDeckId: id, text: card.text, r18: false, kind: card.kind || 'question' }));
  return cards.length ? { id, name: deck.title, participantRule: rule, cards } : null;
}

async function request(config, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}${path}`, { ...options, headers: { apikey: config.key, Authorization: options.headers?.Authorization || `Bearer ${config.key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = null; try { data = await response.json(); } catch { /* empty */ }
  if (response.ok) return data;
  const raw = JSON.stringify(data || '');
  if (/PGRST202|PGRST205|42883|function .* does not exist/i.test(raw)) throw fail(503, 'BUSINESS_MIGRATION_UNAVAILABLE');
  if (/OWNER_REQUIRED|ORG_FORBIDDEN|42501/i.test(raw)) throw fail(403, /OWNER_REQUIRED/.test(raw) ? 'OWNER_REQUIRED' : 'FORBIDDEN');
  if (/ORG_CONFLICT/i.test(raw)) throw fail(409, 'ORG_CONFLICT');
  if (/ORG_LIMIT|ORG_MEMBER_LIMIT|CSV_LIMIT/i.test(raw)) throw fail(409, 'ORG_LIMIT');
  if (/CSV_INVALID|POLICY_INVALID|ORG_INVALID|INVALID_REQUEST/i.test(raw)) throw fail(400, 'INVALID_REQUEST');
  throw fail(response.status === 401 ? 401 : 502, response.status === 401 ? 'UNAUTHENTICATED' : 'BUSINESS_UNAVAILABLE');
}

export function createBusinessService({ env = process.env, fetchImpl = fetch, rateImpl = consumeRate } = {}) {
  const config = accountConfig(env);
  const service = config?.serviceKey ? { ...config, key: config.serviceKey } : null;

  async function enforceRate(user, scope) {
    if (!persistentStoreAvailable() && rateImpl === consumeRate) { if (env.NODE_ENV === 'production' || env.VERCEL) throw fail(503, 'RATE_LIMIT_UNAVAILABLE'); return; }
    try { if (await rateImpl(`business:user:${scope}:${user.id}`) > (scope === 'read' ? 120 : 60)) throw fail(429, 'RATE_LIMITED'); } catch (error) { if (error.code === 'RATE_LIMITED') throw error; if (env.NODE_ENV === 'production' || env.VERCEL) throw fail(503, 'RATE_LIMIT_UNAVAILABLE'); }
  }

  async function current(req, scope = 'mutation') {
    if (!config || !service) throw fail(503, 'BUSINESS_MIGRATION_UNAVAILABLE');
    const bearer = auth(req); if (!bearer) throw fail(401, 'UNAUTHENTICATED');
    const user = await request(config, '/auth/v1/user', { headers: { Authorization: bearer } }, fetchImpl);
    if (!user?.id || !UUID.test(user.id) || !user.email || !user.email_confirmed_at) throw fail(401, 'UNAUTHENTICATED');
    await enforceRate(user, scope);
    return { user, bearer };
  }

  async function rpc(name, args) {
    return request(service, `/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args), headers: { Authorization: `Bearer ${service.key}` } }, fetchImpl);
  }

  async function workspace(user, orgId) {
    validOrg(orgId);
    const raw = await rpc('org_workspace', { p_actor: user.id, p_org: orgId });
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) throw fail(403, 'FORBIDDEN');
    const allowed = value.allowedThemeIds || value.allowed_theme_ids || [];
    const flags = value.featureFlags || value.feature_flags || DEFAULT_FLAGS;
    const result = { organizationId: orgId, organization: value.organization || null, role: value.role, themes: allowed.map(snapshot).filter(Boolean).map((item) => ({ id: item.id, name: item.name, cardCount: item.cards.length, participantRule: item.participantRule })), featureFlags: { ...DEFAULT_FLAGS, ...flags } };
    if (value.role === 'owner' || value.role === 'admin') {
      result.catalog = [...STATIC.keys()].map(snapshot).filter(Boolean).map((item) => ({ id: item.id, name: item.name, cardCount: item.cards.length, participantRule: item.participantRule }));
      result.members = value.members || [];
    }
    return result;
  }

  async function create(req) {
    const { user } = await current(req, 'mutation'); const input = object(req.body);
    if (Object.keys(input).some((key) => !['slug', 'name'].includes(key))) throw fail(400, 'INVALID_REQUEST');
    if (!SLUG.test(input.slug)) throw fail(400, 'INVALID_REQUEST');
    return { organization: await rpc('org_create', { p_actor: user.id, p_slug: text(input.slug, 64), p_name: text(input.name, 120) }) };
  }

  async function list(req) { const { user } = await current(req, 'read'); await rpc('org_claim_members', { p_user: user.id }); return { organizations: await rpc('org_list', { p_actor: user.id }) }; }

  async function memberAction(req, memberId) {
    const { user } = await current(req, 'mutation'); const orgId = validOrg(req.params.orgId); const input = object(req.body);
    if (!UUID.test(memberId) || !Object.keys(input).length || Object.keys(input).some((key) => !['status', 'role'].includes(key))) throw fail(400, 'INVALID_REQUEST');
    if (input.status !== undefined && !['active', 'suspended'].includes(input.status)) throw fail(400, 'INVALID_REQUEST');
    if (input.role !== undefined && !['admin', 'member'].includes(input.role)) throw fail(400, 'INVALID_REQUEST');
    return { member: await rpc('org_set_member', { p_actor: user.id, p_org: orgId, p_member: memberId, p_status: input.status ?? null, p_role: input.role ?? null }) };
  }

  async function importMembers(req, rows) {
    const { user } = await current(req, 'mutation'); const orgId = validOrg(req.params.orgId);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw fail(400, 'CSV_LIMIT');
    const clean = []; const seen = new Set();
    for (const row of rows) {
      const input = object(row); if (Object.keys(input).some((key) => !['email', 'display_name', 'department'].includes(key))) throw fail(400, 'CSV_INVALID');
      const value = email(input.email); if (seen.has(value)) throw fail(400, 'CSV_INVALID'); seen.add(value);
      if (input.display_name == null || input.department === null) throw fail(400, 'CSV_INVALID');
      clean.push({ email: value, display_name: text(input.display_name, 80), department: input.department === undefined || input.department === '' ? '' : text(input.department, 80) });
    }
    return { result: await rpc('org_import_members', { p_actor: user.id, p_org: orgId, p_rows: clean }) };
  }

  async function policy(req) {
    const { user } = await current(req, 'mutation'); const orgId = validOrg(req.params.orgId); const input = object(req.body);
    if (!Array.isArray(input.allowedThemeIds) || !input.featureFlags || typeof input.featureFlags !== 'object' || Array.isArray(input.featureFlags)) throw fail(400, 'INVALID_REQUEST');
    if (Object.keys(input).some((key) => !['allowedThemeIds', 'featureFlags'].includes(key)) || Object.keys(input.featureFlags).some((key) => !FEATURES.includes(key)) || FEATURES.some((key) => typeof input.featureFlags[key] !== 'boolean') || (!input.featureFlags.group_play && !input.featureFlags.solo_play)) throw fail(400, 'INVALID_REQUEST');
    const ids = [...new Set(input.allowedThemeIds)]; if (ids.length !== input.allowedThemeIds.length || ids.some((id) => typeof id !== 'string' || !SLUG.test(id) || id.includes('r18') || !snapshot(id))) throw fail(400, 'INVALID_REQUEST');
    return { policy: await rpc('org_set_policy', { p_actor: user.id, p_org: orgId, p_themes: ids, p_flags: input.featureFlags }) };
  }

  async function metadata(req) { const { user } = await current(req, 'read'); return workspace(user, req.params.orgId); }

  async function start(req) {
    const { user } = await current(req, 'mutation'); const orgId = validOrg(req.params.orgId); const input = object(req.body);
    if (Object.keys(input).some((key) => !['mode', 'themeIds', 'participantCount'].includes(key)) || !['group', 'solo'].includes(input.mode) || !Array.isArray(input.themeIds) || input.themeIds.length < 1 || input.themeIds.length > 3 || input.themeIds.some((id) => typeof id !== 'string') || new Set(input.themeIds).size !== input.themeIds.length || !Number.isInteger(input.participantCount)) throw fail(400, 'INVALID_REQUEST');
    const meta = await workspace(user, orgId);
    if (input.mode === 'group' && !meta.featureFlags.group_play || input.mode === 'solo' && !meta.featureFlags.solo_play) throw fail(403, 'FEATURE_DISABLED');
    if (input.themeIds.length > 1 && !meta.featureFlags.theme_mix) throw fail(403, 'FEATURE_DISABLED');
    if (input.themeIds.some((id) => !meta.themes.some((theme) => theme.id === id))) throw fail(403, 'THEME_NOT_ALLOWED');
    if (input.themeIds.some((id) => !participantCountAllowed(participantRuleForDeck(id), input.participantCount)) || input.mode === 'solo' && input.themeIds.some((id) => participantRuleForDeck(id) !== 'solo') || input.mode === 'group' && input.themeIds.some((id) => participantRuleForDeck(id) === 'solo')) throw fail(400, 'PARTICIPANT_COUNT_INVALID');
    return { organizationId: orgId, mode: input.mode, participantCount: input.participantCount, features: meta.featureFlags, themes: input.themeIds.map(snapshot).map((theme) => ({ id: theme.id, name: theme.name, participantRule: theme.participantRule, cards: theme.cards })) };
  }

  async function removeMember(req, memberId) { const { user } = await current(req, 'mutation'); if (!UUID.test(memberId)) throw fail(400, 'INVALID_REQUEST'); return { removed: await rpc('org_remove_member', { p_actor: user.id, p_org: validOrg(req.params.orgId), p_member: memberId }) }; }
  async function removeOrganization(req, orgId) { const { user } = await current(req, 'mutation'); return { deleted: await rpc('org_delete', { p_actor: user.id, p_org: validOrg(orgId) }) }; }
  return { create, list, memberAction, importMembers, policy, metadata, start, removeMember, removeOrganization };
}
