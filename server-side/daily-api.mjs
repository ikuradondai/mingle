import { createHash, randomBytes } from 'node:crypto';
import { accountConfig } from './accounts.mjs';
import { decks } from '../dist/data/decks.js';
import { eligibleDailyDeck } from './daily-line.mjs';
import { readLineConfig } from './line-messaging.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const bearer = (req) => /^Bearer\s+\S+$/i.test(req.headers?.authorization || '') ? req.headers.authorization : '';
const clean = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const safeGroup = (row) => row && ({ id: row.id, name: row.name, sourceDeckId: row.source_deck_id, sourceDeckName: row.source_deck_name, timezone: row.timezone, deliveryTime: row.delivery_time, status: row.status, nextRunAt: row.next_run_at, createdAt: row.created_at });

export function createDailyApi({ env = process.env, fetchImpl = fetch, random = () => randomBytes(32).toString('base64url') } = {}) {
  const config = accountConfig(env);
  const service = config?.serviceKey ? { ...config, key: config.serviceKey } : null;
  async function request(target, path, options = {}) {
    if (!target) throw fail(503, 'FEATURE_UNAVAILABLE');
    const response = await fetchImpl(`${target.url}${path}`, { ...options, headers: { apikey: target.key, Authorization: options.headers?.Authorization || `Bearer ${target.key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    let data = null; try { data = await response.json(); } catch {}
    if (!response.ok) {
      const known = new Set(['FORBIDDEN', 'NOT_FOUND', 'INVALID_REQUEST', 'INVITE_EXPIRED', 'GROUP_FULL', 'MEMBERSHIP_LIMIT', 'GROUP_PAUSED', 'PERSISTENT_GROUP_LIMIT', 'REJOIN_INVITE_REQUIRED', 'OWNER_REQUIRED_TO_RESUME', 'OWNER_CANNOT_RESUME_MEMBER', 'LINE_NOT_LINKED', 'LINE_LINK_NOT_FOUND', 'LINK_ATTEMPT_INVALID', 'LINE_ID_MISMATCH', 'LINE_ID_ALREADY_LINKED', 'MEMBER_NOT_FOUND', 'GROUP_NOT_FOUND', 'DAILY_NOT_DUE', 'DAILY_SOURCE_MISMATCH', 'DAILY_NOT_CURRENT_DAY']);
      const domain = [data?.code, data?.error, data?.message].map((value) => String(value || '').toUpperCase()).find((value) => known.has(value));
      const code = response.status === 401 ? 'UNAUTHENTICATED' : domain || (response.status === 404 ? 'NOT_FOUND' : response.status === 403 ? 'FORBIDDEN' : response.status === 400 ? 'INVALID_REQUEST' : 'DAILY_LINE_UNAVAILABLE');
      const status = code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' || code === 'GROUP_NOT_FOUND' || code === 'MEMBER_NOT_FOUND' ? 404 : code === 'INVALID_REQUEST' || code === 'LINK_ATTEMPT_INVALID' || code === 'LINE_ID_MISMATCH' ? 400 : ['INVITE_EXPIRED', 'GROUP_FULL', 'MEMBERSHIP_LIMIT', 'GROUP_PAUSED', 'PERSISTENT_GROUP_LIMIT', 'REJOIN_INVITE_REQUIRED', 'OWNER_REQUIRED_TO_RESUME', 'OWNER_CANNOT_RESUME_MEMBER', 'LINE_NOT_LINKED', 'LINE_LINK_NOT_FOUND', 'LINE_ID_ALREADY_LINKED', 'DAILY_NOT_DUE', 'DAILY_SOURCE_MISMATCH', 'DAILY_NOT_CURRENT_DAY'].includes(code) ? 409 : 502;
      throw fail(status, code);
    }
    return data;
  }
  async function user(req) {
    if (!config) throw fail(503, 'FEATURE_UNAVAILABLE');
    const authorization = bearer(req); if (!authorization) throw fail(401, 'UNAUTHENTICATED');
    const found = await request(config, '/auth/v1/user', { headers: { Authorization: authorization } });
    if (!UUID.test(found?.id || '') || found.is_anonymous === true) throw fail(401, 'UNAUTHENTICATED');
    return { id: found.id, authorization };
  }
  async function rpc(name, payload) { return request(service, `/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(payload) }); }
  async function groups(current) {
    const owned = await request(service, `/rest/v1/persistent_groups?owner_user_id=eq.${encodeURIComponent(current.id)}&select=*`, { headers: { Authorization: `Bearer ${service.key}` } });
    const memberships = await request(service, `/rest/v1/persistent_group_members?user_id=eq.${encodeURIComponent(current.id)}&status=neq.left&select=group_id,role,status`, { headers: { Authorization: `Bearer ${service.key}` } });
    const ids = new Set([...(owned || []).map((row) => row.id), ...(memberships || []).map((row) => row.group_id)]);
    if (!ids.size) return [];
    const rows = await request(service, `/rest/v1/persistent_groups?id=in.(${[...ids].map(encodeURIComponent).join(',')})&select=*`, { headers: { Authorization: `Bearer ${service.key}` } });
    return (rows || []).map(safeGroup);
  }
  async function create(current, input) {
    const name = clean(input?.name, 80); const sourceDeckId = clean(input?.sourceDeckId, 80);
    const deck = decks.find((item) => item.id === sourceDeckId);
    if (!name || !deck || !eligibleDailyDeck(deck)) throw fail(400, 'INVALID_REQUEST');
    const timezone = clean(input?.timezone, 64) || 'Asia/Tokyo'; const deliveryTime = clean(input?.deliveryTime, 5) || '09:00';
    if (!/^\d{2}:\d{2}$/.test(deliveryTime) || Number(deliveryTime.slice(0, 2)) > 23 || Number(deliveryTime.slice(3)) > 59) throw fail(400, 'INVALID_REQUEST');
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { throw fail(400, 'INVALID_REQUEST'); }
    return safeGroup(await rpc('persistent_group_create', { p_owner_user_id: current.id, p_name: name, p_source_deck_id: deck.id, p_source_deck_name: deck.title || deck.name || deck.id, p_timezone: timezone, p_delivery_time: deliveryTime }));
  }
  async function invite(current, groupId) {
    if (!UUID.test(groupId)) throw fail(400, 'INVALID_REQUEST');
    const token = random(); const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await rpc('persistent_group_revoke_invites', { p_group_id: groupId, p_owner_user_id: current.id });
    await rpc('persistent_group_create_invite', { p_group_id: groupId, p_owner_user_id: current.id, p_token_hash: hash(token), p_expires_at: expires });
    return { token, expiresAt: expires };
  }
  async function join(current, input) {
    const token = clean(input?.token, 200); const displayName = clean(input?.displayName, 80);
    if (!token || !displayName) throw fail(400, 'INVALID_REQUEST');
    const row = await rpc('persistent_group_accept_invite', { p_token_hash: hash(token), p_user_id: current.id, p_display_name: displayName });
    if (typeof input?.lineOptIn === 'boolean') await rpc('persistent_group_set_line_opt_in', { p_group_id: row.group_id, p_user_id: current.id, p_enabled: input.lineOptIn });
    return { groupId: row.group_id, memberId: row.id, status: row.status, displayName: row.display_name };
  }
  async function group(current, groupId) {
    if (!UUID.test(groupId)) throw fail(400, 'INVALID_REQUEST');
    const rows = await request(service, `/rest/v1/persistent_groups?id=eq.${encodeURIComponent(groupId)}&select=*`, { headers: { Authorization: `Bearer ${service.key}` } });
    const g = rows?.[0]; if (!g) throw fail(404, 'NOT_FOUND');
    const members = await request(service, `/rest/v1/persistent_group_members?group_id=eq.${encodeURIComponent(groupId)}&status=neq.left&select=id,user_id,display_name,role,status,line_opt_in`, { headers: { Authorization: `Bearer ${service.key}` } });
    if (g.owner_user_id !== current.id && !(members || []).some((m) => m.user_id === current.id)) throw fail(403, 'FORBIDDEN');
    const mine = (members || []).find((m) => m.user_id === current.id);
    return { group: { ...safeGroup(g), isOwner: g.owner_user_id === current.id, myOptIn: Boolean(mine?.line_opt_in) }, members: (members || []).map((m) => ({ id: m.id, displayName: m.display_name, role: m.role, status: m.status, lineOptIn: Boolean(m.line_opt_in) })) };
  }
  async function setStatus(current, groupId, input) {
    if (!UUID.test(groupId) || !['active', 'paused'].includes(input?.status)) throw fail(400, 'INVALID_REQUEST');
    return safeGroup(await rpc('persistent_group_set_status', { p_group_id: groupId, p_owner_user_id: current.id, p_status: input.status }));
  }
  async function memberStatus(current, groupId, input) {
    if (!UUID.test(groupId) || !['active', 'paused', 'left'].includes(input?.status) || (input?.memberId !== 'self' && !UUID.test(input?.memberId || ''))) throw fail(400, 'INVALID_REQUEST');
    let memberUserId = current.id;
    if (input.memberId !== 'self' && input.memberId !== current.id) {
      const rows = await request(service, `/rest/v1/persistent_group_members?id=eq.${encodeURIComponent(input.memberId)}&group_id=eq.${encodeURIComponent(groupId)}&select=user_id`, { headers: { Authorization: `Bearer ${service.key}` } });
      if (!rows?.[0]?.user_id) throw fail(404, 'NOT_FOUND');
      memberUserId = rows[0].user_id;
    }
    const row = await rpc('persistent_group_set_member_status', { p_group_id: groupId, p_actor_user_id: current.id, p_member_user_id: memberUserId, p_status: input.status });
    return { id: row.id, status: row.status, displayName: row.display_name };
  }
  async function optIn(current, groupId, input) {
    if (!UUID.test(groupId) || typeof input?.enabled !== 'boolean') throw fail(400, 'INVALID_REQUEST');
    const row = await rpc('persistent_group_set_line_opt_in', { p_group_id: groupId, p_user_id: current.id, p_enabled: input.enabled });
    return { groupId: row.group_id, status: row.status, lineOptIn: Boolean(row.line_opt_in) };
  }
  async function today(current, groupId) {
    if (!UUID.test(groupId)) throw fail(400, 'INVALID_REQUEST');
    const info = await group(current, groupId); const day = new Intl.DateTimeFormat('en-CA', { timeZone: info.group.timezone || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const rows = await request(service, `/rest/v1/daily_questions?group_id=eq.${encodeURIComponent(groupId)}&local_date=eq.${encodeURIComponent(day)}&select=id,local_date,source_deck_id,question_id,question_text,payload`, { headers: { Authorization: `Bearer ${service.key}` } });
    const q = rows?.[0]; return q ? { id: q.id, date: q.local_date, sourceDeckId: q.source_deck_id, questionId: q.question_id, text: q.question_text, payload: q.payload || {} } : null;
  }
  async function checkin(current, groupId, input = {}) {
    if (!UUID.test(groupId)) throw fail(400, 'INVALID_REQUEST');
    const date = clean(input.date, 10); if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, 'INVALID_REQUEST');
    const row = await rpc('daily_record_checkin', { p_group_id: groupId, p_local_date: date, p_user_id: current.id });
    return { date, checkedAt: row.checked_at };
  }
  async function lineStatus(current) {
    const rows = await request(service, `/rest/v1/line_account_links?user_id=eq.${encodeURIComponent(current.id)}&select=status,delivery_paused,linked_at,stopped_at`, { headers: { Authorization: `Bearer ${service.key}` } });
    const row = rows?.[0]; const linked = row?.status === 'active'; return { linked, status: row?.status || 'unlinked', deliveryPaused: Boolean(row?.delivery_paused), linkedAt: row?.linked_at || null, stoppedAt: row?.stopped_at || null };
  }
  async function unlink(current) {
    const rows = await request(service, `/rest/v1/line_account_links?user_id=eq.${encodeURIComponent(current.id)}&select=line_user_id`, { headers: { Authorization: `Bearer ${service.key}` } });
    if (!rows?.[0]?.line_user_id) return { linked: false, status: 'unlinked' };
    await rpc('line_set_link_status', { p_user_id: current.id, p_line_user_id: rows[0].line_user_id, p_status: 'unlinked' });
    return { linked: false, status: 'unlinked' };
  }
  async function bindLine(current, input) {
    const setupToken = clean(input?.setupToken, 200); const lineToken = clean(input?.lineToken, 200);
    if (!setupToken || !lineToken) throw fail(400, 'INVALID_REQUEST');
    const nonce = clean(random(), 256);
    if (!nonce) throw fail(503, 'DAILY_LINE_UNAVAILABLE');
    await rpc('line_bind_link_attempt', { p_setup_token_hash: hash(setupToken), p_user_id: current.id, p_nonce_hash: hash(nonce), p_line_link_token_hash: hash(lineToken) });
    return { pending: true, redirectUrl: `https://access.line.me/dialog/bot/accountLink?linkToken=${encodeURIComponent(lineToken)}&nonce=${encodeURIComponent(nonce)}` };
  }
  async function readiness() { let envReady = false; try { envReady = Boolean(readLineConfig(env).configured); } catch { envReady = false; } let dbReady = false; let dbEnabled = false; if (service) { try { const rows = await request(service, '/rest/v1/line_delivery_settings?id=eq.true&select=enabled', { headers: { Authorization: `Bearer ${service.key}` } }); dbReady = Array.isArray(rows) && rows.length === 1; dbEnabled = dbReady && rows[0].enabled === true; } catch {} } let officialFriendUrl = null; try { const value = clean(env.LINE_OFFICIAL_FRIEND_URL, 300); const url = value ? new URL(value) : null; if (url && url.protocol === 'https:' && /(^|\.)line\.me$/i.test(url.hostname) || url && url.protocol === 'https:' && url.hostname.toLowerCase() === 'lin.ee') officialFriendUrl = url.toString(); } catch {} return { configured: Boolean(service) && dbReady, lineConfigured: envReady, deliveryEnabled: env.LINE_DELIVERY_ENABLED === 'true' && envReady && dbEnabled, officialFriendUrl }; }
  async function eligibleDecks() { return decks.filter((deck) => eligibleDailyDeck(deck)).map((deck) => ({ id: deck.id, name: deck.title || deck.name || deck.id })); }
  async function invitePreview(current, token) {
    const value = clean(token, 200); if (!value) throw fail(400, 'INVALID_REQUEST');
    const rows = await request(service, `/rest/v1/persistent_group_invites?token_hash=eq.${encodeURIComponent(hash(value))}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&revoked_at=is.null&select=group_id`, { headers: { Authorization: `Bearer ${service.key}` } });
    if (!rows?.[0]) throw fail(404, 'NOT_FOUND');
    const info = await request(service, `/rest/v1/persistent_groups?id=eq.${encodeURIComponent(rows[0].group_id)}&select=id,name,source_deck_id,source_deck_name,timezone,delivery_time,status`, { headers: { Authorization: `Bearer ${service.key}` } });
    if (!info?.[0]) throw fail(404, 'NOT_FOUND');
    return safeGroup(info[0]);
  }
  async function history(current, groupId, date) {
    const info = await group(current, groupId); const today = new Intl.DateTimeFormat('en-CA', { timeZone: info.group.timezone || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); let filter = ''; if (date) { const value = clean(date, 10); if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(400, 'INVALID_REQUEST'); const parsed = new Date(`${value}T00:00:00Z`); if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > today) throw fail(400, 'INVALID_REQUEST'); filter = `&local_date=eq.${encodeURIComponent(value)}`; }
    const rows = await request(service, `/rest/v1/daily_questions?group_id=eq.${encodeURIComponent(groupId)}${filter}&local_date=lte.${encodeURIComponent(today)}&order=local_date.desc&limit=31&select=id,local_date,question_id,question_text,payload`, { headers: { Authorization: `Bearer ${service.key}` } });
    return { group: info.group, questions: (rows || []).map((row) => ({ id: row.id, date: row.local_date, questionId: row.question_id, text: row.question_text, payload: row.payload || {} })) };
  }
  async function edit(current, groupId, input) {
    if (!UUID.test(groupId)) throw fail(400, 'INVALID_REQUEST');
    const name = clean(input?.name, 80); const deliveryTime = clean(input?.deliveryTime, 5); const sourceDeckId = clean(input?.sourceDeckId, 80);
    if (!name || !deliveryTime || !/^\d{2}:\d{2}$/.test(deliveryTime) || Number(deliveryTime.slice(0, 2)) > 23 || Number(deliveryTime.slice(3)) > 59) throw fail(400, 'INVALID_REQUEST');
    const deck = decks.find((item) => item.id === sourceDeckId); if (!deck || !eligibleDailyDeck(deck)) throw fail(400, 'INVALID_REQUEST');
    return safeGroup(await rpc('persistent_group_edit', { p_group_id: groupId, p_owner_user_id: current.id, p_name: name, p_source_deck_id: deck.id, p_source_deck_name: deck.title || deck.name || deck.id, p_delivery_time: deliveryTime }));
  }
  async function deleteGroup(current, groupId) { if (!UUID.test(groupId)) throw fail(400, 'INVALID_REQUEST'); await request(service, `/rest/v1/persistent_groups?id=eq.${encodeURIComponent(groupId)}&owner_user_id=eq.${encodeURIComponent(current.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${service.key}` } }); return { deleted: true }; }
  async function revokeInvites(current, groupId) { await rpc('persistent_group_revoke_invites', { p_group_id: groupId, p_owner_user_id: current.id }); return { revoked: true }; }
  async function globalLineStatus(current) { return lineStatus(current); }
  async function globalLinePause(current, paused) { if (typeof paused !== 'boolean') throw fail(400, 'INVALID_REQUEST'); const row = await rpc('line_set_delivery_paused', { p_user_id: current.id, p_paused: paused }); return { status: row.status, deliveryPaused: Boolean(row.delivery_paused) }; }
  return { user, groups, create, invite, join, group, setStatus, edit, deleteGroup, revokeInvites, invitePreview, eligibleDecks, readiness, history, memberStatus, optIn, today, checkin, lineStatus, globalLineStatus, globalLinePause, unlink, bindLine };
}

export function respondDailyError(res, error) { const known = new Set(['FEATURE_UNAVAILABLE', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_REQUEST', 'INVITE_EXPIRED', 'GROUP_FULL', 'MEMBERSHIP_LIMIT', 'GROUP_PAUSED', 'PERSISTENT_GROUP_LIMIT', 'REJOIN_INVITE_REQUIRED', 'OWNER_REQUIRED_TO_RESUME', 'LINE_NOT_LINKED', 'LINE_LINK_NOT_FOUND', 'LINK_ATTEMPT_INVALID', 'LINE_ID_MISMATCH', 'LINE_ID_ALREADY_LINKED', 'MEMBER_NOT_FOUND', 'GROUP_NOT_FOUND', 'OWNER_CANNOT_RESUME_MEMBER', 'DAILY_NOT_DUE', 'DAILY_SOURCE_MISMATCH', 'DAILY_NOT_CURRENT_DAY']); const code = known.has(error?.code) ? error.code : 'DAILY_LINE_UNAVAILABLE'; res.statusCode = error?.status || (code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' || code === 'GROUP_NOT_FOUND' || code === 'MEMBER_NOT_FOUND' ? 404 : code === 'INVALID_REQUEST' || code === 'LINK_ATTEMPT_INVALID' || code === 'LINE_ID_MISMATCH' ? 400 : ['INVITE_EXPIRED', 'GROUP_FULL', 'MEMBERSHIP_LIMIT', 'GROUP_PAUSED', 'PERSISTENT_GROUP_LIMIT', 'REJOIN_INVITE_REQUIRED', 'OWNER_REQUIRED_TO_RESUME', 'OWNER_CANNOT_RESUME_MEMBER', 'LINE_NOT_LINKED', 'LINE_LINK_NOT_FOUND', 'LINE_ID_ALREADY_LINKED', 'DAILY_NOT_DUE', 'DAILY_SOURCE_MISMATCH', 'DAILY_NOT_CURRENT_DAY'].includes(code) ? 409 : 502); return { error: code }; }
