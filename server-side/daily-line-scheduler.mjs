import { accountConfig } from './accounts.mjs';
import { readLineConfig } from './line-messaging.mjs';
import { createDailyLineService } from './daily-line.mjs';
import { timingSafeEqual } from 'node:crypto';

const fail = (status, code) => Object.assign(new Error(code), { status, code });
const MAX_GROUPS = 100;
const MAX_MS = 8000;
const isoDay = (date, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function createDailyScheduler({ env = process.env, fetchImpl = fetch, now = () => new Date(), service = null } = {}) {
  const config = accountConfig(env); const privateConfig = config?.serviceKey ? { ...config, key: config.serviceKey } : null;
  const line = readLineConfig(env);
  const daily = service || createDailyLineService({ env, fetchImpl, now });
  async function rest(path, options = {}) {
    if (!privateConfig) throw fail(503, 'FEATURE_UNAVAILABLE');
    const response = await fetchImpl(`${privateConfig.url}${path}`, { ...options, headers: { apikey: privateConfig.key, Authorization: `Bearer ${privateConfig.key}`, Accept: 'application/json', ...options.headers } });
    let data = null; try { data = await response.json(); } catch {}
    if (!response.ok) throw fail(502, 'DAILY_LINE_UNAVAILABLE');
    return data;
  }
  async function run() {
    if (!line.configured || env.LINE_DELIVERY_ENABLED !== 'true') return { enabled: false, prepared: 0, dispatched: 0 };
    const started = Date.now(); const current = now();
    const groups = await rest(`/rest/v1/persistent_groups?status=eq.active&next_run_at=lte.${encodeURIComponent(current.toISOString())}&order=next_run_at.asc&limit=${MAX_GROUPS}&select=*`);
    let prepared = 0; let dispatched = 0;
    const groupErrors = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      if (Date.now() - started > MAX_MS) break;
      try {
        const day = isoDay(current, group.timezone || 'Asia/Tokyo');
        const history = await rest(`/rest/v1/daily_questions?group_id=eq.${encodeURIComponent(group.id)}&local_date=lt.${encodeURIComponent(day)}&order=local_date.desc&limit=40&select=question_id`);
        await daily.prepareAndAdvance({ groupId: group.id, deckId: group.source_deck_id, localDate: day, usedQuestionIds: (history || []).map((row) => row.question_id).reverse(), expectedRunAt: group.next_run_at });
        prepared += 1;
      } catch (error) {
        groupErrors.push({ groupId: group?.id || null, code: error?.code || 'DAILY_LINE_UNAVAILABLE' });
      }
    }
    let deliveries = [];
    try { deliveries = await daily.listReady(500); } catch (error) { groupErrors.push({ groupId: null, code: error?.code || 'DAILY_LINE_UNAVAILABLE' }); }
    const deliveryErrors = [];
    for (const delivery of deliveries) {
      if (Date.now() - started > MAX_MS) break;
      try {
        const result = await daily.dispatch(delivery.id || delivery.delivery_id);
        if (result.claimed) dispatched += 1;
      } catch (error) {
        deliveryErrors.push({ deliveryId: delivery?.id || delivery?.delivery_id || null, code: error?.code || 'DAILY_LINE_UNAVAILABLE' });
      }
    }
    return { enabled: true, prepared, dispatched, limited: Date.now() - started > MAX_MS, errors: [...groupErrors, ...deliveryErrors] };
  }
  return { run };
}

export function cronSecretMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
  const a = Buffer.from(provided); const b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b);
}
