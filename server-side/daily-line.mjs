import { createHash } from 'node:crypto';
import { decks } from '../dist/data/decks.js';
import { participantRuleForDeck } from '../dist/participant-rule.js';
import { accountConfig } from './accounts.mjs';
import { pushLineMessage, readLineConfig } from './line-messaging.mjs';

const fail = (status, code) => Object.assign(new Error(code), { status, code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value, max = 160) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
const dayKey = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const candidate = String(value || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (!candidate) return null;
  const date = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === candidate ? candidate : null;
};

export function eligibleDailyDeck(deck) {
  const cards = deck?.questions?.filter((card) => card && card.kind !== 'challenge' && card.kind !== 'action' && card.r18 !== true) || [];
  return Boolean(deck && participantRuleForDeck(deck) === 'group' && !deck.adultOnly && cards.length >= 6);
}

export function chooseDailyQuestion({ deck, groupId, localDate, usedQuestionIds = [] }) {
  if (!eligibleDailyDeck(deck)) throw fail(400, 'DAILY_SOURCE_UNAVAILABLE');
  const date = dayKey(localDate);
  if (!date || !UUID.test(String(groupId || ''))) throw fail(400, 'INVALID_DAILY_DATE');
  const cards = deck.questions.filter((card) => card && card.kind !== 'challenge' && card.kind !== 'action' && card.r18 !== true);
  // Keep the latest N-1 selections out of the pool. This gives a complete
  // cycle before any question repeats, while still allowing a new cycle to
  // start without persisting a separate cursor.
  const recent = new Set(usedQuestionIds.slice(-(cards.length - 1)));
  const fresh = cards.filter((card) => !recent.has(card.id));
  const pool = fresh.length ? fresh : cards;
  const digest = createHash('sha256').update(String(groupId) + ':' + date).digest().readUInt32BE(0);
  const card = pool[digest % pool.length];
  return { questionId: card.id, questionText: card.text, sourceDeckId: deck.id, localDate: date };
}

async function rest(config, path, options = {}, fetchImpl = fetch) {
  if (!config) throw fail(503, 'DAILY_LINE_UNAVAILABLE');
  const response = await fetchImpl(config.url + path, { ...options, headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = null; try { data = await response.json(); } catch {}
  if (!response.ok) {
    const known = new Set(['GROUP_NOT_FOUND', 'GROUP_PAUSED', 'DAILY_QUESTION_FINALIZED', 'LINE_DELIVERY_DISABLED', 'DELIVERY_NOT_FOUND', 'PERSISTENT_GROUP_LIMIT', 'GROUP_FULL']);
    const code = known.has(data?.code) ? data.code : 'DAILY_LINE_UNAVAILABLE';
    throw fail(response.status, code);
  }
  return data;
}

export function createDailyLineService({ env = process.env, fetchImpl = fetch, now = () => new Date(), rpcImpl = null, pushImpl = pushLineMessage } = {}) {
  const supabase = accountConfig(env);
  const service = supabase?.serviceKey ? { ...supabase, key: supabase.serviceKey } : null;
  const lineConfig = readLineConfig(env);
  const publicOrigin = typeof env.MINGLE_PUBLIC_ORIGIN === 'string' && /^https:\/\//.test(env.MINGLE_PUBLIC_ORIGIN) ? env.MINGLE_PUBLIC_ORIGIN.replace(/\/$/, '') : 'https://mingle.cards';
  async function rpc(name, payload) { return rpcImpl ? rpcImpl(name, payload) : rest(service, '/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(payload) }, fetchImpl); }
  async function prepare({ groupId, deckId, localDate, usedQuestionIds = [], checkinUrl = '' }) {
    const deck = decks.find((item) => item.id === deckId);
    const selected = chooseDailyQuestion({ deck, groupId, localDate, usedQuestionIds });
    return rpc('daily_prepare_question', { p_group_id: groupId, p_local_date: selected.localDate, p_source_deck_id: selected.sourceDeckId, p_question_id: selected.questionId, p_question_text: selected.questionText, p_payload: { checkinUrl: publicOrigin + '/daily.html#group=' + encodeURIComponent(groupId) + '&date=' + encodeURIComponent(selected.localDate) } });
  }
  async function prepareAndAdvance({ groupId, deckId, localDate, usedQuestionIds = [], expectedRunAt }) {
    const deck = decks.find((item) => item.id === deckId);
    const selected = chooseDailyQuestion({ deck, groupId, localDate, usedQuestionIds });
    return rpc('daily_prepare_and_advance', { p_group_id: groupId, p_local_date: selected.localDate, p_source_deck_id: selected.sourceDeckId, p_question_id: selected.questionId, p_question_text: selected.questionText, p_payload: { checkinUrl: publicOrigin + '/daily.html#group=' + encodeURIComponent(groupId) + '&date=' + encodeURIComponent(selected.localDate) }, p_expected_run_at: expectedRunAt });
  }
  async function claim(deliveryId) {
    const result = await rpc('daily_claim_delivery', { p_delivery_id: deliveryId, p_now: now().toISOString() });
    return Array.isArray(result) ? result[0] || null : result;
  }
  async function complete(deliveryId, leaseToken, result) { return rpc('daily_complete_delivery', { p_delivery_id: deliveryId, p_status: result.ok ? 'sent' : result.deliveryUncertain ? 'unknown' : 'failed', p_lease_token: leaseToken, p_request_id: result.requestId || null, p_error: result.ok ? null : result.failure?.code || 'LINE_PUSH_FAILED', p_now: now().toISOString() }); }
  async function advance(groupId, expectedRunAt) { return rpc('persistent_group_advance_run', { p_group_id: groupId, p_expected_run_at: expectedRunAt }); }
  async function listReady(limit = 500) {
    const bounded = Math.max(1, Math.min(500, Number(limit) || 500));
    const result = await rpc('daily_list_ready_deliveries', { p_now: now().toISOString(), p_limit: bounded });
    return Array.isArray(result) ? result : [];
  }
  async function dispatch(deliveryId) {
    const claimed = await claim(deliveryId);
    if (!claimed || claimed.status !== 'sending') return { claimed: false, delivery: claimed };
    const messageText = (claimed.payload?.question || '今日の問い') + (claimed.payload?.checkinUrl ? '\n' + claimed.payload.checkinUrl : '');
    const result = await pushImpl({ config: lineConfig, destination: claimed.line_user_id, messages: [{ type: 'text', text: messageText }], retryKey: claimed.retry_key, fetchImpl });
    const delivery = await complete(deliveryId, claimed.lease_token, result);
    return { claimed: true, result, delivery };
  }
  return { prepare, prepareAndAdvance, claim, complete, advance, listReady, dispatch };
}
