import { createHash, randomBytes } from 'node:crypto';
import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { createSession, createSavedSession } from '../dist/engine.js';
import { accountConfig } from './accounts.mjs';
import { AGE_ERRORS, requireAdultConfirmed } from './age-confirmation.mjs';
import { normalizeCreatorDesign } from '../dist/creator-metadata.js';
import { participantRuleForDeck, participantRuleForSavedSet } from '../dist/participant-rule.js';
import { consumeRate, persistentStoreAvailable } from './store.mjs';

const MIN = 2;
const MAX = 8;
const ROUND = 6;
const TTL_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const shuffle = (items) => { const output = [...items]; for (let i = output.length - 1; i > 0; i -= 1) { const n = randomBytes(2).readUInt16BE(0) % (i + 1); [output[i], output[n]] = [output[n], output[i]]; } return output; };
const text = (value, max = 80) => typeof value === 'string' && value.trim() && value.trim().length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
const auth = (req) => /^Bearer\s+\S+$/i.test(req.headers?.authorization || '') ? req.headers.authorization : '';
const bodyObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const isoOrNull = (value) => { if (!value) return null; const time = new Date(value); return Number.isNaN(time.getTime()) ? null : time.toISOString(); };
const optionalBoolean = (value) => { if (value !== undefined && typeof value !== 'boolean') throw fail(400, 'INVALID_REQUEST'); };

async function rest(config, path, options = {}, fetchImpl = fetch) {
  if (!config) throw fail(503, 'GROUP_UNAVAILABLE');
  const response = await fetchImpl(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.key, Authorization: `Bearer ${config.key}`, Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers
    }
  });
  let data = null; try { data = await response.json(); } catch {}
  if (!response.ok) {
    const message = data?.message || data?.hint || data?.details || (typeof data === 'string' ? data : '');
    const forbidden = ['ADULT_CONSENT_REQUIRED', AGE_ERRORS.required, AGE_ERRORS.attestation, AGE_ERRORS.participant];
    const known = ['GROUP_FULL', 'GROUP_EXPIRED', 'GROUP_ALREADY_STARTED', ...forbidden, 'DUPLICATE'];
    const code = known.find((item) => String(message).includes(item)) || (response.status === 404 ? 'NOT_FOUND' : 'GROUP_UNAVAILABLE');
    const status = code === 'GROUP_EXPIRED' ? 410 : forbidden.includes(code) ? 403 : ['GROUP_FULL', 'GROUP_ALREADY_STARTED', 'DUPLICATE'].includes(code) ? 409 : response.status === 404 ? 404 : 502;
    throw fail(status, code);
  }
  return data;
}

export function createGroupRoomService({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const config = accountConfig(env);
  const service = config?.serviceKey ? { ...config, key: config.serviceKey } : null;
  let lastCleanup = 0;
  async function ownerRate(ownerId) { if (!persistentStoreAvailable()) { if (env.NODE_ENV === 'production' || env.VERCEL) throw fail(503, 'RATE_LIMIT_UNAVAILABLE'); return; } try { if (await consumeRate(`group-create:${ownerId}`) > 10) throw fail(429, 'RATE_LIMITED'); } catch (error) { if (error.code === 'RATE_LIMITED') throw error; if (env.NODE_ENV === 'production' || env.VERCEL) throw fail(503, 'RATE_LIMIT_UNAVAILABLE'); } }
    const staticCards = new Map([...decks, ...soloDecks].flatMap((deck) => [...(deck.questions || []), ...(deck.r18Questions || [])].map((card) => [card.id, { id: card.id, text: card.text, r18: Boolean(card.r18 || deck.adultOnly), sourceDeckId: deck.id }])));
  async function host(req) {
    if (!service) throw fail(503, 'GROUP_UNAVAILABLE');
    const bearer = auth(req); if (!bearer) throw fail(401, 'UNAUTHENTICATED');
    const response = await fetchImpl(`${service.url}/auth/v1/user`, { headers: { apikey: service.key, Authorization: bearer, Accept: 'application/json' } });
    let user = null; try { user = await response.json(); } catch {}
    if (!response.ok || !user?.id || user.is_anonymous === true) throw fail(401, 'UNAUTHENTICATED');
    return { id: user.id, bearer };
  }
  function validId(id) { if (!UUID.test(String(id || ''))) throw fail(400, 'INVALID_REQUEST'); return String(id); }
  function roomParticipantRule(room) {
    if (room?.participant_rule === 'pair') return 'pair';
    if (room?.participant_rule === 'group') return 'group';
    if (Array.isArray(room?.cards) && room.cards.some((card) => card?.participantRule === 'pair')) return 'pair';
    return 'group';
  }
  async function cleanupExpired() {
    if (now() - lastCleanup < 5 * 60 * 1000) return;
    lastCleanup = now();
    await rest(service, `/rest/v1/group_rooms?expires_at=lte.${encodeURIComponent(new Date(now()).toISOString())}`, { method: 'DELETE' }, fetchImpl).catch(() => {});
  }
  async function getRoom(id) {
    const roomId = validId(id);
    const rows = await rest(service, `/rest/v1/group_rooms?id=eq.${encodeURIComponent(roomId)}&select=*`, {}, fetchImpl);
    const room = rows?.[0]; if (!room) throw fail(404, 'NOT_FOUND');
    if (new Date(room.expires_at).getTime() <= now()) { await cleanupExpired(); throw fail(410, 'GROUP_EXPIRED'); }
    await cleanupExpired();
    return room;
  }
  async function members(id) {
    const rows = (await rest(service, `/rest/v1/group_members?room_id=eq.${encodeURIComponent(id)}&select=id,display_name,role,adult_confirmed,age_confirmed_at,joined_at&order=role.desc,joined_at.asc,id.asc`, {}, fetchImpl)) || [];
    return rows.sort((a, b) => Number(b.role === 'host') - Number(a.role === 'host') || String(a.joined_at).localeCompare(String(b.joined_at)) || String(a.id).localeCompare(String(b.id)));
  }
  function publicRoom(room, member, includeCard = false, list = []) {
    const cards = Array.isArray(room.cards) ? room.cards : [];
    const card = includeCard && room.status === 'playing' && room.revealed && cards[room.cursor] ? cards[room.cursor] : null;
    const memberCount = Number(room.member_count ?? list.length);
    const speaker = list.length ? list[(Number(room.cursor || 0) + Number(room.answer_index || 0)) % list.length] : null;
    const participantRule = roomParticipantRule(room);
    return { room: { id: room.id, deckId: room.deck_id, deckName: room.deck_name, adultOnly: Boolean(room.adult_only), design: normalizeCreatorDesign(room.design), participantRule, participantLimit: participantRule === 'pair' ? 2 : 8, status: room.status, cursor: room.cursor, total: cards.length, revealed: Boolean(room.revealed), answerIndex: room.answer_index, speakerIndex: speaker ? list.indexOf(speaker) : null, speakerName: speaker?.display_name || null, revision: room.revision, expiresAt: room.expires_at, adultAttestedAt: isoOrNull(room.adult_attested_at), memberCount, members: list.map((item) => ({ id: item.id, name: item.display_name, role: item.role, adultConfirmed: item.adult_confirmed, ageConfirmed: Boolean(item.age_confirmed_at) })) }, member: member ? { id: member.id, name: member.display_name, role: member.role, adultConfirmed: member.adult_confirmed, ageConfirmed: Boolean(member.age_confirmed_at) } : null, card: card ? { id: card.id, text: card.text, r18: Boolean(card.r18) } : null };
  }
  async function projected(room, member, includeCard) { return publicRoom(room, member, includeCard, await members(room.id)); }
  async function resolveSet(ownerId, setId) {
    if (!setId || !/^[0-9a-f-]{16,64}$/i.test(setId)) throw fail(400, 'INVALID_REQUEST');
    const sets = await rest(service, `/rest/v1/my_sets?id=eq.${encodeURIComponent(setId)}&user_id=eq.${encodeURIComponent(ownerId)}&select=*`, {}, fetchImpl);
    const set = sets?.[0]; if (!set || !Array.isArray(set.card_ids)) throw fail(404, 'NOT_FOUND');
    if (set.audience === 'solo') throw fail(400, 'SOLO_ONLY_SOURCE');
    if (set.card_ids.length < 6 || set.card_ids.length > 40 || new Set(set.card_ids).size !== set.card_ids.length) throw fail(400, 'GROUP_THEME_UNAVAILABLE');
    const customIds = set.card_ids.filter((id) => String(id).startsWith('custom:')).map((id) => String(id).slice(7));
    const custom = customIds.length ? await rest(service, `/rest/v1/custom_cards?user_id=eq.${encodeURIComponent(ownerId)}&id=in.(${customIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,text,r18`, {}, fetchImpl) : [];
    const customMap = new Map((custom || []).map((card) => [`custom:${card.id}`, { id: `custom:${card.id}`, text: card.text, r18: card.r18 === true }]));
    const cards = set.card_ids.map((id) => staticCards.get(id) || customMap.get(id));
    if (cards.some((card) => !card)) throw fail(400, 'GROUP_THEME_UNAVAILABLE');
    return { id: set.id, name: set.name, cardIds: set.card_ids, customCards: custom || [], cards, adultOnly: (set.theme_r18 === true) || cards.some((card) => card.r18 === true), r18: set.theme_r18 === true, design: normalizeCreatorDesign(set.design), audience: set.audience || 'group', questionOrder: set.question_order || 'shuffle' };
  }
  async function adultGate(owner, input) {
    await requireAdultConfirmed({ config: service, userId: owner.id, authorization: `Bearer ${service.key}`, fetchImpl });
    if (input.participantsAdultAttested !== true) throw fail(403, AGE_ERRORS.attestation);
    if (input.adultConfirmed !== true) throw fail(403, 'ADULT_CONSENT_REQUIRED');
  }
  async function create(req) {
    const owner = await host(req); await ownerRate(owner.id); const input = bodyObject(req.body); optionalBoolean(input.participantsAdultAttested); let gated = false; const deckId = text(input.deckId, 80); const setId = text(input.setId, 80); const deck = decks.find((item) => item.id === deckId);
    let source;
    const hostName = text(input.hostName, 40) || '代表者';
    if (setId) {
      source = await resolveSet(owner.id, setId);
      if (source.adultOnly) { await adultGate(owner, input); gated = true; }
      const session = createSavedSession({ participants: [hostName, '参加者2'], cardIds: source.cardIds, customCards: source.customCards, ownerUserId: owner.id, questionOrder: source.questionOrder, r18: source.r18 === true, design: source.design, participantRule: participantRuleForSavedSet(source, 'group'), adultConfirmed: input.adultConfirmed === true });
      source.cards = session.questions.map((card) => ({ id: card.id, text: card.text, r18: card.r18 === true, sourceDeckId: card.sourceDeckId || null, participantRule: participantRuleForSavedSet(source, 'group') }));
      source.adultOnly = session.includeR18 === true;
    } else {
      if (!deck) throw fail(400, soloDecks.some((item) => item.id === deckId) ? 'SOLO_ONLY_SOURCE' : 'GROUP_THEME_UNAVAILABLE');
      const includeR18 = input.includeR18 === true && deck.adultOnly !== true;
      if (input.includeR18 !== undefined && typeof input.includeR18 !== 'boolean') throw fail(400, 'INVALID_REQUEST');
      if (includeR18 || deck.adultOnly) { await adultGate(owner, input); gated = true; }
      const session = createSession({ participants: [hostName, '参加者2'], deck, participantRule: participantRuleForDeck(deck), adultConfirmed: input.adultConfirmed === true, includeR18 });
      const participantRule = participantRuleForDeck(deck);
      source = { id: deck.id, name: deck.title, cards: session.questions.map((card) => ({ id: card.id, text: card.text, r18: card.r18 === true, sourceDeckId: deck.id, participantRule })), adultOnly: session.includeR18 === true || deck.adultOnly === true, participantRule };
    }
    const cards = source.cards;
    if (cards.length < 6 || cards.length > 40) throw fail(400, 'GROUP_THEME_UNAVAILABLE');
    if (source.adultOnly && !gated) await adultGate(owner, input);
    const invite = token();
    const hostSecret = token();
    const created = await rest(service, '/rest/v1/rpc/group_create_room', { method: 'POST', body: JSON.stringify({ p_host_user_id: owner.id, p_invite_hash: hash(invite), p_deck_id: source.id, p_deck_name: source.name, p_cards: cards, p_adult_only: source.adultOnly, p_host_secret_hash: hash(hostSecret), p_host_name: hostName, p_expires_at: new Date(now() + TTL_MS).toISOString(), p_adult_attested: source.adultOnly === true && input.participantsAdultAttested === true }) }, fetchImpl);
    const pair = Array.isArray(created) ? created[0] : created;
    const room = await getRoom(pair?.room_id); const hostRows = await rest(service, `/rest/v1/group_members?id=eq.${encodeURIComponent(pair?.host_member_id)}&select=*`, {}, fetchImpl);
    if (!room || !hostRows?.[0]) throw fail(502, 'GROUP_UNAVAILABLE');
    return { ...(await projected(room, hostRows[0], true)), inviteToken: invite, memberToken: hostSecret, host: true };
  }
  async function join(req, id) {
    const room = await getRoom(id);
    const input = bodyObject(req.body); const invite = text(input.inviteToken, 128); const name = text(input.name, 40);
    optionalBoolean(input.ageConfirmed);
    if (!invite || !name || hash(invite) !== room.invite_hash) throw fail(404, 'NOT_FOUND');
    if (room.adult_only && input.ageConfirmed !== true) throw fail(403, AGE_ERRORS.participant);
    if (room.adult_only && input.adultConfirmed !== true) throw fail(403, 'ADULT_CONSENT_REQUIRED');
    const secret = text(input.memberSecret, 64) || token();
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw fail(400, 'INVALID_REQUEST');
    if (roomParticipantRule(room) === 'pair') {
      const existing = await rest(service, `/rest/v1/group_members?room_id=eq.${encodeURIComponent(room.id)}&secret_hash=eq.${encodeURIComponent(hash(secret))}&select=id`, {}, fetchImpl);
      if (!existing?.length && (await members(room.id)).length >= 2) throw fail(409, 'GROUP_FULL');
    }
    let rows;
    try { rows = await rest(service, '/rest/v1/rpc/group_join_member', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_secret_hash: hash(secret), p_display_name: name, p_adult_confirmed: input.adultConfirmed === true, p_age_confirmed: input.ageConfirmed === true }) }, fetchImpl); }
    catch (error) { if (error.code === 'GROUP_FULL') throw fail(409, 'GROUP_FULL'); if (error.code === 'GROUP_ALREADY_STARTED') throw fail(409, 'GROUP_ALREADY_STARTED'); if (error.code === 'ADULT_CONSENT_REQUIRED') throw fail(403, 'ADULT_CONSENT_REQUIRED'); if (error.code === AGE_ERRORS.participant) throw fail(403, AGE_ERRORS.participant); throw error; }
    const member = Array.isArray(rows) ? rows[0] : rows; const fresh = await getRoom(room.id);
    return { ...(await projected(fresh, member)), memberToken: secret, host: false };
  }
  async function preview(req, id) {
    const room = await getRoom(id); const input = bodyObject(req.body);
    const invite = text(input.inviteToken, 128);
    if (!invite || hash(invite) !== room.invite_hash) throw fail(404, 'NOT_FOUND');
    if (room.status !== 'lobby') throw fail(409, 'GROUP_ALREADY_STARTED');
    return { room: { id: room.id, deckId: room.adult_only ? null : room.deck_id, deckName: room.adult_only ? null : room.deck_name, adultOnly: Boolean(room.adult_only), adultAttestedAt: isoOrNull(room.adult_attested_at), status: room.status, total: Array.isArray(room.cards) ? room.cards.length : 0, memberCount: Number(room.member_count || 0), expiresAt: room.expires_at } };
  }
  async function member(id, secret, ownerReq = null) {
    const room = await getRoom(id);
    if (ownerReq) { const owner = await host(ownerReq); if (owner.id !== room.host_user_id) throw fail(403, 'FORBIDDEN'); return { room, member: null, owner }; }
    if (!secret) throw fail(401, 'GROUP_MEMBER_REQUIRED');
    const rows = await rest(service, `/rest/v1/group_members?room_id=eq.${encodeURIComponent(room.id)}&secret_hash=eq.${encodeURIComponent(hash(secret))}&select=*`, {}, fetchImpl); const found = rows?.[0];
    if (!found) throw fail(403, 'FORBIDDEN'); return { room, member: found, owner: null };
  }
  async function state(req, id) {
    const secret = req.headers?.['x-group-member-token'] || req.headers?.['X-Group-Member-Token'] || '';
    const found = await member(id, secret, secret ? null : req);
    const actualMember = found.owner ? (await members(found.room.id)).find((item) => item.role === 'host') || null : found.member;
    return { ...(await projected(found.room, actualMember, Boolean(actualMember))), host: Boolean(found.owner) };
  }
  async function action(req, id) {
    const input = bodyObject(req.body); const found = await member(id, '', req); const room = found.room;
    if (room.status === 'ended') throw fail(409, 'GROUP_ENDED');
    if (!Number.isInteger(input.revision) || input.revision !== Number(room.revision)) throw fail(409, 'GROUP_STALE');
    const update = { revision: room.revision + 1, updated_at: new Date(now()).toISOString() };
    if (input.action === 'start') {
      if (room.status !== 'lobby') throw fail(409, 'GROUP_ALREADY_STARTED');
      const participantRule = roomParticipantRule(room);
      if (participantRule === 'pair' ? Number(room.member_count) !== 2 : Number(room.member_count) < MIN || Number(room.member_count) > MAX) throw fail(400, 'GROUP_PARTICIPANTS');
      const roster = await members(room.id);
      if (room.adult_only && roster.some((item) => !item.age_confirmed_at)) throw fail(403, AGE_ERRORS.participant);
      if (room.adult_only && roster.some((item) => item.adult_confirmed !== true)) throw fail(403, 'ADULT_CONSENT_REQUIRED');
      update.status = 'playing';
    }
    else if (input.action === 'reveal') { if (room.status !== 'playing' || room.revealed) throw fail(409, 'GROUP_NOT_STARTED'); update.revealed = true; }
    else if (input.action === 'next' || input.action === 'pass') {
      if (room.status !== 'playing' || !room.revealed) throw fail(409, 'GROUP_NOT_REVEALED');
      const memberCount = Math.max(1, Number(room.member_count || 1));
      if (room.answer_index + 1 < memberCount) { update.answer_index = room.answer_index + 1; update.revealed = true; }
      else {
        const next = Math.min(room.cursor + 1, room.cards.length); update.cursor = next; update.revealed = false; update.answer_index = 0;
        if (next > 0 && next < room.cards.length && next % ROUND === 0) update.status = 'break';
        if (next >= room.cards.length) update.status = 'ended';
      }
    }
    else if (input.action === 'continue') { if (room.status !== 'break') throw fail(409, 'GROUP_NOT_ON_BREAK'); update.status = 'playing'; }
    else if (input.action === 'finish') { update.status = 'ended'; update.revealed = false; }
    else throw fail(400, 'INVALID_REQUEST');
    const rows = await rest(service, `/rest/v1/group_rooms?id=eq.${encodeURIComponent(room.id)}&host_user_id=eq.${encodeURIComponent(found.owner.id)}&revision=eq.${encodeURIComponent(room.revision)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(update) }, fetchImpl);
    if (!rows?.[0]) throw fail(409, 'GROUP_STALE');
    const hostRows = await rest(service, `/rest/v1/group_members?room_id=eq.${encodeURIComponent(room.id)}&role=eq.host&select=*`, {}, fetchImpl);
    return { ...(await projected(rows[0], hostRows?.[0] || null, rows[0].status === 'playing' && rows[0].revealed)), host: true };
  }
  return { create, join, preview, state, action, available: Boolean(service) };
}
