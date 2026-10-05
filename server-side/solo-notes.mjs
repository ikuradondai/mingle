import { accountConfig } from './accounts.mjs';
import { requireAdultConfirmed, readAdultConfirmation } from './age-confirmation.mjs';
import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';

const MAX_NOTE = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE_ID = UUID;
const MAX_LIMIT = 50;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/u;

export const SOLO_NOTE_ERRORS = {
  unavailable: 'FEATURE_UNAVAILABLE',
  auth: 'UNAUTHENTICATED',
  invalid: 'INVALID_REQUEST',
  forbidden: 'FORBIDDEN',
};

function fail(status, code) { const error = new Error(code); error.status = status; error.code = code; return error; }
function authorization(req) {
  const value = req.headers?.authorization || '';
  return /^Bearer\s+\S+$/i.test(value) ? value : '';
}
function cleanText(value, max = MAX_NOTE) {
  if (typeof value !== 'string') throw fail(400, SOLO_NOTE_ERRORS.invalid);
  const text = value.replace(/\r\n?/g, '\n');
  if (!text.trim() || Array.from(text).length > max || CONTROL.test(text)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
  return text;
}
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function jsonValue(value) { try { return JSON.parse(value); } catch { return null; } }
function encodeCursor(row) { return Buffer.from(JSON.stringify({ at: row.created_at, id: row.id }), 'utf8').toString('base64url'); }
function decodeCursor(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 240) throw fail(400, SOLO_NOTE_ERRORS.invalid);
  const decoded = jsonValue(Buffer.from(value, 'base64url').toString('utf8'));
  if (!decoded || typeof decoded.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(decoded.at) || !uuid(decoded.id) || Number.isNaN(Date.parse(decoded.at))) throw fail(400, SOLO_NOTE_ERRORS.invalid);
  return decoded;
}
function authUserIsAnonymous(user) { return user?.is_anonymous === true || user?.user_metadata?.is_anonymous === true; }

async function request(config, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}${path}`, { ...options, headers: { apikey: config.key, Authorization: options.headers?.Authorization || `Bearer ${config.key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = null; try { data = await response.json(); } catch { /* empty */ }
  if (!response.ok) {
    const raw = JSON.stringify(data || '');
    if (/PGRST205|42P01|42703/i.test(raw)) throw fail(503, SOLO_NOTE_ERRORS.unavailable);
    if (/23505|duplicate key/i.test(raw) && options.method === 'POST') throw fail(409, 'CONFLICT');
    throw fail(response.status === 401 ? 401 : response.status === 404 ? 404 : 502, response.status === 401 ? SOLO_NOTE_ERRORS.auth : response.status === 404 ? 'NOT_FOUND' : SOLO_NOTE_ERRORS.unavailable);
  }
  return data;
}

export function createSoloNoteService({ env = process.env, fetchImpl = fetch } = {}) {
  const config = accountConfig(env);
  async function requireUser(req) {
    if (!config) throw fail(503, SOLO_NOTE_ERRORS.unavailable);
    const auth = authorization(req); if (!auth) throw fail(401, SOLO_NOTE_ERRORS.auth);
    const user = await request(config, '/auth/v1/user', { headers: { Authorization: auth } }, fetchImpl);
    if (!user?.id || !uuid(user.id)) throw fail(401, SOLO_NOTE_ERRORS.auth);
    if (authUserIsAnonymous(user)) throw fail(403, SOLO_NOTE_ERRORS.forbidden);
    return { user, auth };
  }
  function allDecks() { return [...decks, ...soloDecks]; }
  const staticCards = new Map(allDecks().flatMap((deck) => [...(deck.questions || []), ...(deck.r18Questions || [])].map((card) => [card.id, { ...card, r18: Boolean(card.r18 || deck.adultOnly) }])));
  function findDeck(id) { return allDecks().find((deck) => deck.id === id) || null; }
  function staticCard(deck, questionId) { return (deck?.questions || []).find((card) => card.id === questionId) || (deck?.r18Questions || []).find((card) => card.id === questionId) || null; }
  async function ownedSet(userId, auth, sourceId) {
    if (!uuid(sourceId)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const sets = await request(config, `/rest/v1/my_sets?id=eq.${encodeURIComponent(sourceId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,name,card_ids,audience,question_order`, { headers: { Authorization: auth } }, fetchImpl);
    const set = Array.isArray(sets) ? sets[0] : null;
    if (!set || !Array.isArray(set.card_ids)) throw fail(404, 'NOT_FOUND');
    if (!['solo', 'both'].includes(set.audience)) throw fail(400, 'SOLO_SOURCE_REQUIRED');
    const customIds = set.card_ids.filter((id) => String(id).startsWith('custom:')).map((id) => id.slice(7));
    const customRows = customIds.length ? await request(config, `/rest/v1/custom_cards?user_id=eq.${encodeURIComponent(userId)}&id=in.(${customIds.map(encodeURIComponent).join(',')})&select=id,text,r18`, { headers: { Authorization: auth } }, fetchImpl) : [];
    const custom = new Map((Array.isArray(customRows) ? customRows : []).map((row) => [`custom:${row.id}`, { id: `custom:${row.id}`, text: row.text, r18: Boolean(row.r18) }]));
    const cardMap = new Map(set.card_ids.map((id) => [id, custom.get(id) || staticCards.get(id) || null]));
    return { sourceId: set.id, sourceTitle: set.name, cardIds: set.card_ids, cardMap, hasAdult: [...cardMap.values()].some((card) => card?.r18 === true), metadata: { audience: set.audience || 'group', questionOrder: set.question_order || 'shuffle' } };
  }
  async function resolveSource(input, userId, auth) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const sourceType = input.sourceType;
    const sourceId = input.sourceId;
    if (sourceType === 'deck') {
      const deck = findDeck(sourceId);
      if (!deck || deck.audience !== 'solo') throw fail(400, 'SOLO_SOURCE_REQUIRED');
      const cardMap = new Map([...deck.questions || [], ...deck.r18Questions || []].map((card) => [card.id, { ...card, r18: Boolean(card.r18 || deck.adultOnly) }]));
      return { sourceType, sourceId: deck.id, sourceTitle: deck.title, cardIds: [...cardMap.keys()], cardMap, hasAdult: [...cardMap.values()].some((card) => card.r18 === true) };
    }
    if (sourceType === 'set') return { sourceType, ...(await ownedSet(userId, auth, sourceId)) };
    throw fail(400, SOLO_NOTE_ERRORS.invalid);
  }
  function slot(input) {
    const slotKind = input?.slotKind;
    if (!['question', 'summary'].includes(slotKind)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    if (!Number.isInteger(input.roundNumber) || input.roundNumber < 1 || input.roundNumber > 7) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    if (slotKind === 'question') {
      if (typeof input.questionId !== 'string' || !input.questionId || input.questionId.length > 180) throw fail(400, SOLO_NOTE_ERRORS.invalid);
      return { slotKind, questionId: input.questionId, slotKey: `question:${input.questionId}`, roundNumber: input.roundNumber };
    }
    if (Object.prototype.hasOwnProperty.call(input, 'questionId') && input.questionId != null) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    return { slotKind, questionId: null, slotKey: `summary:${input.roundNumber}`, roundNumber: input.roundNumber };
  }
  function map(row, locked = false) { return locked ? { id: row.id, sessionId: row.session_id, sourceType: row.source_type, sourceId: row.source_id, roundNumber: row.round_number, slotKind: row.slot_kind, locked: true, note: null, sourceTitle: null, questionText: null, createdAt: row.created_at, updatedAt: row.updated_at } : { id: row.id, sessionId: row.session_id, sourceType: row.source_type, sourceId: row.source_id, sourceTitle: row.source_title, questionId: row.question_id, questionText: row.question_text, roundNumber: row.round_number, slotKind: row.slot_kind, note: row.note, r18: row.r18 === true, createdAt: row.created_at, updatedAt: row.updated_at }; }
  async function upsert(req) {
    const { user, auth } = await requireUser(req); const input = req.body;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const allowed = ['sessionId', 'sourceType', 'sourceId', 'questionId', 'roundNumber', 'slotKind', 'note'];
    if (Object.keys(input).some((key) => !allowed.includes(key)) || !uuid(input.sessionId)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const source = await resolveSource(input, user.id, auth); const target = slot(input);
    const card = target.slotKind === 'question' ? source.cardMap.get(target.questionId) : null;
    if (target.slotKind === 'question' && !card) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    if (source.hasAdult || card?.r18 === true) await requireAdultConfirmed({ config, userId: user.id, authorization: auth, fetchImpl });
    const note = cleanText(input.note);
    const payload = { user_id: user.id, session_id: input.sessionId, slot_key: target.slotKey, source_type: source.sourceType, source_id: source.sourceId, source_title: source.sourceTitle, question_id: target.questionId, question_text: card?.text || null, round_number: target.roundNumber, slot_kind: target.slotKind, note, r18: source.hasAdult === true || card?.r18 === true };
    const result = await request(config, '/rest/v1/solo_notes?on_conflict=user_id,session_id,slot_key', { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: auth, Prefer: 'resolution=merge-duplicates,return=representation' } }, fetchImpl);
    const row = Array.isArray(result) ? result[0] : result; if (!row) throw fail(502, SOLO_NOTE_ERRORS.unavailable); return { note: map(row) };
  }
  async function list(req) {
    const { user, auth } = await requireUser(req); const url = new URL(req.url || '/', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId'); if (sessionId && !uuid(sessionId)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const rawLimit = Number(url.searchParams.get('limit') || 20); if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const cursor = decodeCursor(url.searchParams.get('cursor')); const filters = [`user_id=eq.${encodeURIComponent(user.id)}`]; if (sessionId) filters.push(`session_id=eq.${encodeURIComponent(sessionId)}`); if (cursor) filters.push(`or=(created_at.lt.${encodeURIComponent(cursor.at)},and(created_at.eq.${encodeURIComponent(cursor.at)},id.lt.${encodeURIComponent(cursor.id)}))`);
    const rows = await request(config, `/rest/v1/solo_notes?${filters.join('&')}&select=id,session_id,source_type,source_id,source_title,question_id,question_text,round_number,slot_kind,note,r18,created_at,updated_at&order=created_at.desc,id.desc&limit=${rawLimit + 1}`, { headers: { Authorization: auth } }, fetchImpl);
    const values = Array.isArray(rows) ? rows : []; const hasMore = values.length > rawLimit; const page = hasMore ? values.slice(0, rawLimit) : values;
    let confirmed = false; try { confirmed = Boolean((await readAdultConfirmation({ config, userId: user.id, authorization: auth, fetchImpl })).confirmedAt); } catch { confirmed = false; }
    return { notes: page.map((row) => map(row, row.r18 === true && !confirmed)), nextCursor: hasMore ? encodeCursor(page.at(-1)) : null };
  }
  async function edit(req, noteId) {
    const { user, auth } = await requireUser(req); if (!NOTE_ID.test(noteId)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const input = req.body; if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.note !== 'string') throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const existing = await request(config, `/rest/v1/solo_notes?id=eq.${encodeURIComponent(noteId)}&user_id=eq.${encodeURIComponent(user.id)}&select=r18`, { headers: { Authorization: auth } }, fetchImpl); if (Array.isArray(existing) && existing[0]?.r18 === true) await requireAdultConfirmed({ config, userId: user.id, authorization: auth, fetchImpl });
    const updated = await request(config, `/rest/v1/solo_notes?id=eq.${encodeURIComponent(noteId)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify({ note: cleanText(input.note) }), headers: { Authorization: auth, Prefer: 'return=representation' } }, fetchImpl);
    const row = Array.isArray(updated) ? updated[0] : updated; if (!row) throw fail(404, 'NOT_FOUND'); return { note: map(row) };
  }
  async function remove(req, noteId) {
    const { user, auth } = await requireUser(req); if (!NOTE_ID.test(noteId)) throw fail(400, SOLO_NOTE_ERRORS.invalid);
    const deleted = await request(config, `/rest/v1/solo_notes?id=eq.${encodeURIComponent(noteId)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: { Authorization: auth, Prefer: 'return=representation' } }, fetchImpl);
    if (!Array.isArray(deleted) || !deleted.length) throw fail(404, 'NOT_FOUND'); return { deleted: true, id: noteId };
  }
  return { upsert, list, edit, remove, available: Boolean(config) };
}
