import { createHash, randomBytes } from 'node:crypto';
import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { createSession, createSavedSession } from '../dist/engine.js';
import { accountConfig } from './accounts.mjs';
import { AGE_ERRORS, requireAdultConfirmed } from './age-confirmation.mjs';
import { normalizeCreatorDesign } from '../dist/creator-metadata.js';
import { participantRuleForDeck, participantRuleForSavedSet } from '../dist/participant-rule.js';
import { consumeRate, persistentStoreAvailable } from './store.mjs';
import { minorityTopics } from '../dist/data/minority-topics.js';
import { questionWolfTopics } from '../dist/data/question-wolf-topics.js';
import { OCHI_ERROR_CODES, ochiAction, ochiCreatePayload, ochiInput, ochiSource, ochiState } from './ochi-kara.mjs';
import { ONE_CUT_ERROR_CODES, oneCutAction, oneCutCreatePayload, oneCutInput, oneCutSource, oneCutState } from './one-cut.mjs';
import { MISSION_ERROR_STATUS, missionAction, missionCreatePayload, missionInput, missionSource, missionState } from './mission-mingle.mjs';

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

// Game-type table: every per-game branch of this service is looked up here.
// Adding a game = adding one entry (plus its own server-side/<game>.mjs handlers).
// `createPayload({ common, gi, source, input })` builds the create RPC body; `common` carries the host/invite/expiry fields.
// State projection and action handlers are bound per service instance in createGroupRoomService.
const GAME_TYPES = {
  cards: { allowed: true, revisionExempt: false, errors: {}, stateKey: null, createRpc: 'group_create_room', venueToken: false, cardCountCheck: true, input: () => null,
    createPayload: ({ common, source, input }) => ({ ...common, p_deck_id: source.id, p_deck_name: source.name, p_cards: source.cards, p_adult_only: source.adultOnly, p_adult_attested: source.adultOnly === true && input.participantsAdultAttested === true })
  },
  minority_topic: {
    allowed: true, revisionExempt: true, stateKey: 'minority', createRpc: 'minority_create_room', venueToken: true, cardCountCheck: true,
    errors: Object.fromEntries(['MINORITY_SELF_VOTE', 'MINORITY_ALREADY_VOTED', 'MINORITY_VOTE_CLOSED', 'MINORITY_PHASE', 'MINORITY_STALE_ROUND', 'MINORITY_PAIRS_EXHAUSTED', 'MINORITY_NOT_STARTED'].map((code) => [code, 409])),
    input: () => ({ type: 'minority_topic', pairs: minorityTopics.map(({ majority, minority }) => ({ majority, minority })) }),
    createPayload: ({ common, gi }) => ({ ...common, p_pairs: gi.pairs }),
    source: (gameInput) => {
      const cards = gameInput.pairs.map((pair, index) => ({ id: `minority:${index}`, text: pair.majority, r18: false, sourceDeckId: 'minority_topic', participantRule: 'group' }));
      while (cards.length < 6) cards.push({ ...cards[cards.length % gameInput.pairs.length], id: `minority:pad:${cards.length}` });
      return { id: 'minority_topic', name: 'ひとりだけ違うお題', cards, adultOnly: false, participantRule: 'group' };
    }
  },
  question_wolf: {
    allowed: true, revisionExempt: true, stateKey: 'questionWolf', createRpc: 'question_wolf_create_room', venueToken: true, cardCountCheck: false,
    errors: Object.fromEntries(['QUESTION_WOLF_PHASE', 'QUESTION_WOLF_TURN', 'QUESTION_WOLF_DISCUSSION_ACTIVE', 'QUESTION_WOLF_VOTE_CLOSED', 'QUESTION_WOLF_ALREADY_VOTED', 'QUESTION_WOLF_PAIRS_INVALID', 'QUESTION_WOLF_PAIRS_EXHAUSTED', 'QUESTION_WOLF_UNAVAILABLE', 'QUESTION_WOLF_STALE_ROUND', 'QUESTION_WOLF_NOT_STARTED'].map((code) => [code, 409])),
    input: () => ({ type: 'question_wolf', pairs: questionWolfTopics.map(({ majority, minority }) => ({ majority, minority })) }),
    createPayload: ({ common, gi }) => ({ ...common, p_pairs: gi.pairs }),
    source: (gameInput) => ({ id: 'question_wolf', name: '質問ウルフ', cards: gameInput.pairs.slice(0, 40).map((pair, index) => ({ id: `question-wolf:${index}`, text: pair.majority, r18: false, sourceDeckId: 'question_wolf', participantRule: 'group' })), adultOnly: false, participantRule: 'group' })
  },
  ochi_kara: {
    allowed: true, revisionExempt: true, stateKey: 'ochi', createRpc: 'ochi_create_room', venueToken: true, cardCountCheck: false,
    errors: Object.fromEntries(OCHI_ERROR_CODES.map((code) => [code, 409])),
    input: ochiInput, source: ochiSource, createPayload: ochiCreatePayload
  },
  one_cut: {
    allowed: true, revisionExempt: true, stateKey: 'oneCut', createRpc: 'one_cut_create_room', venueToken: true, cardCountCheck: false,
    errors: Object.fromEntries(ONE_CUT_ERROR_CODES.map((code) => [code, 409])),
    input: oneCutInput, source: oneCutSource, createPayload: oneCutCreatePayload
  },
  mission_mingle: {
    allowed: true, revisionExempt: true, stateKey: 'mission', createRpc: 'mission_create_room', venueToken: true, cardCountCheck: false,
    errors: MISSION_ERROR_STATUS, // MISSION_NOT_OWNER is the one 403; rest() reads the status straight from this table
    input: missionInput, source: missionSource, createPayload: missionCreatePayload
  }
};
const gameEntry = (gameType) => (typeof gameType === 'string' && Object.hasOwn(GAME_TYPES, gameType) && GAME_TYPES[gameType].allowed ? GAME_TYPES[gameType] : null);
const gameErrors = Object.assign({}, ...Object.values(GAME_TYPES).map((entry) => entry.errors));

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
    const known = ['GROUP_FULL', 'GROUP_EXPIRED', 'GROUP_ALREADY_STARTED', 'GROUP_STALE', 'FORBIDDEN', ...Object.keys(gameErrors), ...forbidden, 'DUPLICATE'];
    const code = known.find((item) => String(message).includes(item)) || (response.status === 404 ? 'NOT_FOUND' : 'GROUP_UNAVAILABLE');
    const status = code === 'GROUP_EXPIRED' ? 410 : forbidden.includes(code) || code === 'FORBIDDEN' ? 403 : ['GROUP_FULL', 'GROUP_ALREADY_STARTED', 'DUPLICATE', 'GROUP_STALE'].includes(code) ? 409 : gameErrors[code] || (response.status === 404 ? 404 : 502);
    throw fail(status, code);
  }
  return data;
}

export function createGroupRoomService({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const config = accountConfig(env);
  const service = config?.serviceKey ? { ...config, key: config.serviceKey } : null;
  let lastCleanup = 0;
  const MINORITY_MAX_ROUNDS = 6;
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
  function gameInput(input) {
    if (input.gameType !== undefined && !gameEntry(input.gameType)) throw fail(400, 'INVALID_REQUEST');
    return gameEntry(input.gameType)?.input(input) || null;
  }
  async function cleanupExpired() {
    if (now() - lastCleanup < 5 * 60 * 1000) return;
    lastCleanup = now();
    const cutoff = encodeURIComponent(new Date(now()).toISOString());
    await rest(service, `/rest/v1/group_rooms?expires_at=lte.${cutoff}`, { method: 'DELETE' }, fetchImpl).catch(() => {});
    // a finished game keeps only its minimal closing result, for 5 minutes (result_expires_at); sweep what has lapsed (also done lazily on state reads)
    await Promise.all(['ochi_results', 'one_cut_results', 'mission_results'].map((table) => rest(service, `/rest/v1/${table}?result_expires_at=lte.${cutoff}`, { method: 'DELETE' }, fetchImpl).catch(() => {})));
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
  function publicRoom(room, member, includeCard = false, list = [], gameState = null) {
    const cards = Array.isArray(room.cards) ? room.cards : [];
    const card = includeCard && room.status === 'playing' && room.revealed && cards[room.cursor] ? cards[room.cursor] : null;
    const memberCount = Number(room.member_count ?? list.length);
    const speaker = list.length ? list[(Number(room.cursor || 0) + Number(room.answer_index || 0)) % list.length] : null;
    const participantRule = roomParticipantRule(room);
    return { room: { id: room.id, gameType: room.game_type || 'cards', deckId: room.deck_id, deckName: room.deck_name, adultOnly: Boolean(room.adult_only), design: normalizeCreatorDesign(room.design), participantRule, participantLimit: participantRule === 'pair' ? 2 : 8, status: room.status, cursor: room.cursor, total: cards.length, revealed: Boolean(room.revealed), answerIndex: room.answer_index, speakerIndex: speaker ? list.indexOf(speaker) : null, speakerName: speaker?.display_name || null, revision: room.revision, expiresAt: room.expires_at, adultAttestedAt: isoOrNull(room.adult_attested_at), memberCount, members: list.map((item) => ({ id: item.id, name: item.display_name, role: item.role, adultConfirmed: item.adult_confirmed, ageConfirmed: Boolean(item.age_confirmed_at) })) }, member: member ? { id: member.id, name: member.display_name, role: member.role, adultConfirmed: member.adult_confirmed, ageConfirmed: Boolean(member.age_confirmed_at) } : null, card: card ? { id: card.id, text: card.text, r18: Boolean(card.r18) } : null, ...(gameState && gameEntry(room.game_type)?.stateKey ? { [gameEntry(room.game_type).stateKey]: gameState } : {}) };
  }
  async function minorityState(room, member) {
    if (room.game_type !== 'minority_topic') return null;
    const games = await rest(service, `/rest/v1/minority_games?room_id=eq.${encodeURIComponent(room.id)}&select=*`, {}, fetchImpl); const game = games?.[0];
    if (!game) return room.status === 'ended' ? { phase: 'ended', round: 0, maxRounds: MINORITY_MAX_ROUNDS, myWord: null, myRole: null } : { phase: 'lobby', round: 0, maxRounds: MINORITY_MAX_ROUNDS };
    if (room.status === 'ended' || game.phase === 'ended') return { phase: 'ended', round: Number(game.round_no || 0), maxRounds: MINORITY_MAX_ROUNDS, myWord: null, myRole: null };
    const rounds = game.round_no ? await rest(service, `/rest/v1/minority_rounds?room_id=eq.${encodeURIComponent(room.id)}&round_no=eq.${game.round_no}&select=*`, {}, fetchImpl) : [];
    const round = rounds?.[0]; const mine = member && round?.assignments?.[member.id];
    const voteRows = round ? await rest(service, `/rest/v1/minority_votes?round_id=eq.${encodeURIComponent(round.id)}&select=voter_id,target_id`, {}, fetchImpl) : [];
    const result = { phase: game.phase, round: Number(game.round_no || 0), maxRounds: MINORITY_MAX_ROUNDS, confirmed: Boolean(round?.confirmed?.[member?.id]), confirmedCount: Object.keys(round?.confirmed || {}).length, memberHasVoted: Boolean(voteRows?.some((vote) => vote.voter_id === member?.id)), votedCount: voteRows?.length || 0, memberCount: Object.keys(round?.assignments || {}).length, myWord: mine?.word || null, myRole: null };
    if (round && game.phase === 'result' && round.status === 'result') {
      const votes = voteRows;
      const tally = {}; for (const vote of votes || []) tally[vote.target_id] = (tally[vote.target_id] || 0) + 1;
      result.tally = tally; result.assignments = Object.fromEntries(Object.entries(round.assignments || {}).map(([id, value]) => [id, { word: value.word, role: value.role }])); result.majorityWord = round.majority_word; result.minorityWord = round.minority_word; result.minorityMemberId = Object.entries(round.assignments || {}).find(([, value]) => value.role === 'minority')?.[0] || null;
      const max = Math.max(0, ...Object.values(tally)); const winners = Object.entries(tally).filter(([, count]) => count === max).map(([id]) => id);
      result.outcome = winners.length !== 1 ? 'draw' : (round.assignments[winners[0]]?.role === 'minority' ? 'majority_win' : 'minority_win');
    }
    return result;
  }
  async function questionWolfState(room, member) {
    if (room.game_type !== 'question_wolf') return null;
    let game; let round; let votes; let stableRoom;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startRoom = await getRoom(room.id);
      const games = await rest(service, `/rest/v1/question_wolf_games?room_id=eq.${encodeURIComponent(room.id)}&select=*`, {}, fetchImpl); game = games?.[0];
      if (!game) { Object.assign(room, startRoom); return { phase: 'lobby', round: 0, maxRounds: 6 }; }
      if (startRoom.status === 'ended' || game.phase === 'ended') { Object.assign(room, startRoom); return { phase: 'ended', round: Number(game.round_no || 0), maxRounds: 6, myQuestion: null }; }
      const rows = game.round_no ? await rest(service, `/rest/v1/question_wolf_rounds?room_id=eq.${encodeURIComponent(room.id)}&round_no=eq.${game.round_no}&select=*`, {}, fetchImpl) : [];
      round = rows?.[0];
      if (round?.status === 'discussion' && round.discussion_deadline && new Date(round.discussion_deadline).getTime() <= now()) {
        await rest(service, '/rest/v1/rpc/question_wolf_expire_discussion', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: game.round_no }) }, fetchImpl).catch(() => {});
        continue;
      }
      votes = round ? await rest(service, `/rest/v1/question_wolf_votes?round_id=eq.${encodeURIComponent(round.id)}&select=voter_id,target_id`, {}, fetchImpl) : [];
      const endRoom = await getRoom(room.id);
      if (startRoom.revision === endRoom.revision && startRoom.status === endRoom.status) { stableRoom = endRoom; break; }
    }
    if (!stableRoom) throw fail(409, 'GROUP_STALE');
    Object.assign(room, stableRoom);
    if (stableRoom.status === 'ended' || game.phase === 'ended') return { phase: 'ended', round: Number(game.round_no || 0), maxRounds: 6, myQuestion: null };
    const mine = member && round?.assignments?.[member.id];
    const result = { phase: round?.status || game.phase, round: Number(game.round_no || 0), maxRounds: 6, confirmed: Boolean(round?.confirmed?.[member?.id]), confirmedCount: Object.keys(round?.confirmed || {}).length, answerIndex: Number(round?.answer_index || 0), answeredMemberId: round?.answer_order?.[Number(round?.answer_index || 0)] || null, discussionStartedAt: isoOrNull(round?.discussion_started_at), discussionDeadline: isoOrNull(round?.discussion_deadline), serverNow: new Date(now()).toISOString(), memberHasVoted: Boolean(votes?.some((v) => v.voter_id === member?.id)), votedCount: votes?.length || 0, memberCount: Object.keys(round?.assignments || {}).length, myQuestion: mine?.question || null };
    if (round && round.status === 'result') {
      result.phase = 'result';
      const tally = {}; for (const vote of votes || []) tally[vote.target_id] = (tally[vote.target_id] || 0) + 1;
      result.tally = tally; result.majorityQuestion = round.majority_question; result.minorityQuestion = round.minority_question; result.minorityMemberId = Object.entries(round.assignments || {}).find(([, value]) => value.role === 'minority')?.[0] || null;
      const max = Math.max(0, ...Object.values(tally)); const winners = Object.entries(tally).filter(([, count]) => count === max).map(([id]) => id); result.outcome = winners.length !== 1 ? 'draw' : (winners[0] === result.minorityMemberId ? 'majority_win' : 'minority_win');
    }
    return result;
  }
  function nextMinorityPair(game) {
    const used = new Set(Array.isArray(game.used_pairs) ? game.used_pairs.map(Number) : []);
    const candidates = game.pairs.map((pair, index) => ({ pair, index })).filter(({ index }) => !used.has(index));
    if (!candidates.length) throw fail(409, 'MINORITY_PAIRS_EXHAUSTED');
    const picked = candidates[randomBytes(2).readUInt16BE(0) % candidates.length];
    const flipped = randomBytes(1)[0] % 2 === 1;
    return { pair: flipped ? { majority: picked.pair.minority, minority: picked.pair.majority } : picked.pair, index: picked.index, usedPairs: [...used, picked.index] };
  }
  function nextQuestionPair(game) {
    const used = new Set(Array.isArray(game.used_pairs) ? game.used_pairs.map(Number) : []);
    const candidates = game.pairs.map((pair, index) => ({ pair, index })).filter(({ index }) => !used.has(index));
    if (!candidates.length) throw fail(409, 'QUESTION_WOLF_PAIRS_EXHAUSTED');
    const picked = candidates[randomBytes(2).readUInt16BE(0) % candidates.length];
    const flipped = randomBytes(1)[0] % 2 === 1;
    return { pair: flipped ? { majority: picked.pair.minority, minority: picked.pair.majority } : picked.pair, index: picked.index, usedPairs: [...used, picked.index] };
  }
  const ochiCtx = { rest: (path, options = {}) => rest(service, path, options, fetchImpl), getRoom, members, now };
  const oneCutCtx = { ...ochiCtx };
  const missionCtx = { ...ochiCtx };
  const gameProjectors = { minority_topic: minorityState, question_wolf: questionWolfState, ochi_kara: (room, member) => ochiState(ochiCtx, room, member), one_cut: (room, member, list, receivedAt) => oneCutState(oneCutCtx, room, member, receivedAt), mission_mingle: (room, member, list) => missionState(missionCtx, room, member, list) };
  async function projected(room, member, includeCard, receivedAt = now()) { const list = await members(room.id); return publicRoom(room, member, includeCard, list, gameProjectors[room.game_type] ? await gameProjectors[room.game_type](room, member, list, receivedAt) : null); }
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
    const owner = await host(req); await ownerRate(owner.id); const input = bodyObject(req.body); optionalBoolean(input.participantsAdultAttested); const gi = gameInput(input); const entry = gi ? GAME_TYPES[gi.type] : GAME_TYPES.cards; let gated = false; const deckId = text(input.deckId, 80); const setId = text(input.setId, 80); const deck = decks.find((item) => item.id === deckId);
    if (gi && (deckId || setId || input.pairs !== undefined)) throw fail(400, 'INVALID_REQUEST');
    if (entry.venueToken && input.venueToken !== undefined) {
      const venueToken = text(input.venueToken, 64);
      if (!venueToken || !/^[A-Za-z0-9_-]{32}$/.test(venueToken)) throw fail(400, 'INVALID_REQUEST');
      const venueRows = await rest(service, `/rest/v1/venue_tables?token_hash=eq.${encodeURIComponent(hash(venueToken))}&active=is.true&select=id,venues!inner(id,active)&venues.active=is.true&limit=1`, {}, fetchImpl);
      if (!venueRows?.[0] || venueRows[0].venues?.active === false) throw fail(404, 'NOT_FOUND');
    }
    let source;
    const hostName = text(input.hostName, 40) || '代表者';
    if (gi && entry.source) {
      source = entry.source(gi);
    } else if (setId) {
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
    if (entry.cardCountCheck && (cards.length < 6 || cards.length > 40)) throw fail(400, 'GROUP_THEME_UNAVAILABLE');
    if (source.adultOnly && !gated) await adultGate(owner, input);
    const invite = token();
    const hostSecret = token();
    const expiresAt = new Date(now() + TTL_MS).toISOString();
    const common = { p_host_user_id: owner.id, p_invite_hash: hash(invite), p_host_secret_hash: hash(hostSecret), p_host_name: hostName, p_expires_at: expiresAt };
    const created = await rest(service, `/rest/v1/rpc/${entry.createRpc}`, { method: 'POST', body: JSON.stringify(entry.createPayload({ common, gi, source, input })) }, fetchImpl);
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
    return { room: { id: room.id, gameType: room.game_type || 'cards', deckId: room.adult_only ? null : room.deck_id, deckName: room.adult_only ? null : room.deck_name, adultOnly: Boolean(room.adult_only), adultAttestedAt: isoOrNull(room.adult_attested_at), status: room.status, total: Array.isArray(room.cards) ? room.cards.length : 0, memberCount: Number(room.member_count || 0), expiresAt: room.expires_at } };
  }
  async function member(id, secret, ownerReq = null) {
    const room = await getRoom(id);
    if (ownerReq) { const owner = await host(ownerReq); if (owner.id !== room.host_user_id) throw fail(403, 'FORBIDDEN'); return { room, member: null, owner }; }
    if (!secret) throw fail(401, 'GROUP_MEMBER_REQUIRED');
    const rows = await rest(service, `/rest/v1/group_members?room_id=eq.${encodeURIComponent(room.id)}&secret_hash=eq.${encodeURIComponent(hash(secret))}&select=*`, {}, fetchImpl); const found = rows?.[0];
    if (!found) throw fail(403, 'FORBIDDEN'); return { room, member: found, owner: null };
  }
  async function state(req, id) {
    const receivedAt = now();
    const secret = req.headers?.['x-group-member-token'] || req.headers?.['X-Group-Member-Token'] || '';
    const found = await member(id, secret, secret ? null : req);
    const actualMember = found.owner ? (await members(found.room.id)).find((item) => item.role === 'host') || null : found.member;
    return { ...(await projected(found.room, actualMember, Boolean(actualMember), receivedAt)), host: Boolean(found.owner) || actualMember?.role === 'host' };
  }
  async function action(req, id) {
    const input = bodyObject(req.body); const secret = req.headers?.['x-group-member-token'] || req.headers?.['X-Group-Member-Token'] || '';
    const initial = await member(id, secret, secret ? null : req); const room = initial.room;
    if (room.status === 'ended') throw fail(409, 'GROUP_ENDED');
    if (!gameEntry(room.game_type)?.revisionExempt && (!Number.isInteger(input.revision) || input.revision !== Number(room.revision))) throw fail(409, 'GROUP_STALE');
    if (room.game_type === 'ochi_kara') {
      const actor = initial.member || (await members(room.id)).find((item) => item.role === 'host');
      if (!actor) throw fail(403, 'FORBIDDEN');
      await ochiAction(ochiCtx, { room, actor, input });
      const fresh = await getRoom(room.id); return { ...(await projected(fresh, actor, false)), host: actor.role === 'host' };
    }
    if (room.game_type === 'one_cut') {
      const actor = initial.member || (await members(room.id)).find((item) => item.role === 'host');
      if (!actor) throw fail(403, 'FORBIDDEN');
      await oneCutAction(oneCutCtx, { room, actor, input });
      const fresh = await getRoom(room.id); return { ...(await projected(fresh, actor, false)), host: actor.role === 'host' };
    }
    if (room.game_type === 'mission_mingle') {
      const actor = initial.member || (await members(room.id)).find((item) => item.role === 'host');
      if (!actor) throw fail(403, 'FORBIDDEN');
      await missionAction(missionCtx, { room, actor, input });
      const fresh = await getRoom(room.id); return { ...(await projected(fresh, actor, false)), host: actor.role === 'host' };
    }
    if (room.game_type === 'question_wolf') {
      const actor = initial.member || (await members(room.id)).find((item) => item.role === 'host');
      if (!actor) throw fail(403, 'FORBIDDEN');
      const hostActions = ['start','vote_open','next_round','finish']; if (hostActions.includes(input.action) && actor.role !== 'host') throw fail(403, 'FORBIDDEN');
      const strictRevisionActions = [...hostActions, 'answer'];
      if (!Number.isInteger(input.roundNo) && input.action !== 'start') throw fail(400, 'INVALID_REQUEST');
      if (strictRevisionActions.includes(input.action) && (!Number.isInteger(input.revision) || input.revision !== Number(room.revision))) throw fail(409, 'GROUP_STALE');
      const gameRows = await rest(service, `/rest/v1/question_wolf_games?room_id=eq.${encodeURIComponent(room.id)}&select=*`, {}, fetchImpl); const game = gameRows?.[0]; if (!game) throw fail(409, 'QUESTION_WOLF_UNAVAILABLE');
      if (input.action === 'finish') { if (Number(input.roundNo) !== Number(game.round_no)) throw fail(409, 'QUESTION_WOLF_STALE_ROUND'); await rest(service, '/rest/v1/rpc/question_wolf_finish', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: Number(input.roundNo), p_member_id: actor.id, p_expected_revision: room.revision }) }, fetchImpl); const fresh = await getRoom(room.id); return { ...(await projected(fresh, actor, false)), host: true }; }
      if (input.action === 'start') {
        if (room.status !== 'lobby' || Number(room.member_count) < 3 || Number(room.member_count) > 8) throw fail(400, 'GROUP_PARTICIPANTS');
        const roster = await members(room.id); const selected = nextQuestionPair(game); const minorityMember = shuffle(roster)[0]; const assignments = Object.fromEntries(roster.map((m) => [m.id, { question: m.id === minorityMember.id ? selected.pair.minority : selected.pair.majority, role: m.id === minorityMember.id ? 'minority' : 'majority' }]));
        await rest(service, '/rest/v1/rpc/question_wolf_start_round', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: 1, p_majority: selected.pair.majority, p_minority: selected.pair.minority, p_assignments: assignments, p_used_pairs: selected.usedPairs, p_expected_revision: room.revision }) }, fetchImpl);
      } else {
        if (Number(input.roundNo) !== Number(game.round_no)) throw fail(409, 'QUESTION_WOLF_STALE_ROUND');
        let rows = await rest(service, `/rest/v1/question_wolf_rounds?room_id=eq.${encodeURIComponent(room.id)}&round_no=eq.${game.round_no}&select=*`, {}, fetchImpl); let round = rows?.[0]; if (!round) throw fail(409, 'QUESTION_WOLF_NOT_STARTED');
        if (input.action === 'confirm') await rest(service, '/rest/v1/rpc/question_wolf_confirm', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: game.round_no, p_member_id: actor.id }) }, fetchImpl);
        else if (input.action === 'answer') await rest(service, '/rest/v1/rpc/question_wolf_answer', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: game.round_no, p_member_id: actor.id, p_expected_revision: room.revision }) }, fetchImpl);
        else if (input.action === 'vote_open') await rest(service, '/rest/v1/rpc/question_wolf_open_vote', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: game.round_no, p_member_id: actor.id, p_expected_revision: room.revision }) }, fetchImpl);
        else if (input.action === 'vote') { const targetId = text(input.targetId, 80); if (!UUID.test(targetId || '')) throw fail(400, 'INVALID_REQUEST'); await rest(service, '/rest/v1/rpc/question_wolf_cast_vote', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: game.round_no, p_voter_id: actor.id, p_target_id: targetId, p_expected_revision: room.revision }) }, fetchImpl); }
        else if (input.action === 'next_round') {
          if (round.status !== 'result' || Number(game.round_no) >= 6) throw fail(409, 'QUESTION_WOLF_PHASE'); const nextNo = Number(game.round_no) + 1; const selected = nextQuestionPair(game); const minorityMember = shuffle(await members(room.id))[0]; const assignments = Object.fromEntries((await members(room.id)).map((m) => [m.id, { question: m.id === minorityMember.id ? selected.pair.minority : selected.pair.majority, role: m.id === minorityMember.id ? 'minority' : 'majority' }])); await rest(service, '/rest/v1/rpc/question_wolf_start_round', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: nextNo, p_majority: selected.pair.majority, p_minority: selected.pair.minority, p_assignments: assignments, p_used_pairs: selected.usedPairs, p_expected_revision: room.revision }) }, fetchImpl);
        } else throw fail(400, 'INVALID_REQUEST');
      }
      const fresh = await getRoom(room.id); return { ...(await projected(fresh, actor, false)), host: actor.role === 'host' };
    }
    if (room.game_type === 'minority_topic') {
      const actor = initial.member || (await members(room.id)).find((item) => item.role === 'host');
      if (!actor) throw fail(403, 'FORBIDDEN');
      if (['start','vote_open','next_round','finish'].includes(input.action) && actor.role !== 'host') throw fail(403, 'FORBIDDEN');
      if (!Number.isInteger(input.roundNo) && input.action !== 'start') throw fail(400, 'INVALID_REQUEST');
      if (['start','vote_open','next_round','finish'].includes(input.action) && (!Number.isInteger(input.revision) || input.revision !== Number(room.revision))) throw fail(409, 'GROUP_STALE');
      const gameRows = await rest(service, `/rest/v1/minority_games?room_id=eq.${encodeURIComponent(room.id)}&select=*`, {}, fetchImpl); const game = gameRows?.[0];
      if (!game) throw fail(409, 'MINORITY_UNAVAILABLE');
      if (input.action === 'finish') { await rest(service, '/rest/v1/rpc/minority_finish', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: Number(game.round_no || input.roundNo || 0), p_member_id: actor.id, p_expected_revision: room.revision }) }, fetchImpl); const fresh = await getRoom(room.id); return { ...(await projected(fresh, actor, false)), host: actor.role === 'host' }; }
      if (input.action === 'start') {
        if (room.status !== 'lobby' || Number(room.member_count) < 3 || Number(room.member_count) > 8) throw fail(400, 'GROUP_PARTICIPANTS');
        const roster = await members(room.id); const selected = nextMinorityPair(game); const pair = selected.pair; const shuffled = shuffle(roster); const minorityMember = shuffled[0]; const assignments = Object.fromEntries(roster.map((m) => [m.id, { word: m.id === minorityMember.id ? pair.minority : pair.majority, role: m.id === minorityMember.id ? 'minority' : 'majority' }]));
        await rest(service, '/rest/v1/rpc/minority_start_round', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: 1, p_majority: pair.majority, p_minority: pair.minority, p_assignments: assignments, p_used_pairs: selected.usedPairs, p_expected_revision: room.revision }) }, fetchImpl);
        const updated = await getRoom(room.id);
        return { ...(await projected(updated, actor, false)), host: actor.role === 'host' };
      }
      if (input.action !== 'start' && Number(input.roundNo) !== Number(game.round_no)) throw fail(409, 'MINORITY_STALE_ROUND');
      const rounds = await rest(service, `/rest/v1/minority_rounds?room_id=eq.${encodeURIComponent(room.id)}&round_no=eq.${game.round_no}&select=*`, {}, fetchImpl); const round = rounds?.[0];
      if (!round) throw fail(409, 'MINORITY_NOT_STARTED');
      if (input.action === 'confirm') {
        if (round.status !== 'confirm') throw fail(409, 'MINORITY_PHASE'); await rest(service, '/rest/v1/rpc/minority_confirm', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: game.round_no, p_member_id: actor.id }) }, fetchImpl);
      } else if (input.action === 'vote_open') {
        if (round.status !== 'talk') throw fail(409, 'MINORITY_PHASE'); await rest(service, '/rest/v1/rpc/minority_set_phase', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: game.round_no, p_member_id: actor.id, p_phase: 'vote', p_expected_revision: room.revision }) }, fetchImpl);
      } else if (input.action === 'vote') {
        const targetId = text(input.targetId, 80); if (!UUID.test(targetId || '')) throw fail(400, 'INVALID_REQUEST');
        await rest(service, '/rest/v1/rpc/minority_cast_vote', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: game.round_no, p_voter_id: actor.id, p_target_id: targetId }) }, fetchImpl);
      } else if (input.action === 'next_round') {
        if (round.status !== 'result' || Number(game.round_no) >= MINORITY_MAX_ROUNDS) throw fail(409, 'MINORITY_PHASE'); const nextNo = Number(game.round_no) + 1; const selected = nextMinorityPair(game); const pair = selected.pair; const shuffled = shuffle(await members(room.id)); const minorityMember = shuffled[0]; const assignments = Object.fromEntries(shuffled.map((m) => [m.id, { word: m.id === minorityMember.id ? pair.minority : pair.majority, role: m.id === minorityMember.id ? 'minority' : 'majority' }])); await rest(service, '/rest/v1/rpc/minority_start_round', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_round_no: nextNo, p_majority: pair.majority, p_minority: pair.minority, p_assignments: assignments, p_used_pairs: selected.usedPairs, p_expected_revision: room.revision }) }, fetchImpl);
      } else throw fail(400, 'INVALID_REQUEST');
      const fresh = await getRoom(room.id); return { ...(await projected(fresh, actor, false)), host: actor.role === 'host' };
    }
    // Legacy card-room actions remain bearer-authenticated host operations.
    const found = await member(id, '', req);
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
