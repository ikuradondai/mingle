import { createHash, randomBytes } from 'node:crypto';
import { json, rawBodyWithLimit } from '../../server-side/http.mjs';
import { accountConfig } from '../../server-side/accounts.mjs';
import { issueLineLinkToken, readLineConfig, replyLineMessage, verifyLineWebhookSignature } from '../../server-side/line-messaging.mjs';

const MAX = 256 * 1024;
// @vercel/node parses request.body by default. Deploy this route with the
// documented NODEJS_HELPERS=0 setting so the IncomingMessage stream remains
// available; parsed-object fallback is rejected by rawBodyWithLimit.
const hash = (value) => createHash('sha256').update(value).digest('hex');
const text = (value, max = 160) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
async function rest(config, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}${path}`, { ...options, headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = null; try { data = await response.json(); } catch {}
  if (!response.ok) {
    const code = [data?.code, data?.error, data?.message].map((value) => String(value || '').toUpperCase()).find((value) => ['LINK_ATTEMPT_INVALID', 'LINE_ID_MISMATCH', 'LINE_ID_ALREADY_LINKED', 'INVALID_REQUEST'].includes(value));
    const error = new Error(code || 'LINE_WEBHOOK_STORAGE_UNAVAILABLE');
    error.code = code || 'LINE_WEBHOOK_STORAGE_UNAVAILABLE';
    throw error;
  }
  return data;
}
export function createLineWebhookHandler({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  return async function webhook(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const line = readLineConfig(env);
  if (!line.configured) return json(res, 503, { error: 'LINE_NOT_CONFIGURED' });
  let raw;
  try { raw = await rawBodyWithLimit(req, MAX); } catch (error) { return json(res, error.status || 413, { error: error.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST' }); }
  const signature = req.headers?.['x-line-signature'] || '';
  if (!verifyLineWebhookSignature(raw, signature, line.channelSecret)) return json(res, 401, { error: 'INVALID_SIGNATURE' });
  let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'INVALID_REQUEST' }); }
  const config = accountConfig(env);
  if (!config?.serviceKey) return json(res, 503, { error: 'FEATURE_UNAVAILABLE' });
  const service = { ...config, key: config.serviceKey };
  const origin = typeof env.MINGLE_PUBLIC_ORIGIN === 'string' && /^https:\/\//.test(env.MINGLE_PUBLIC_ORIGIN) ? env.MINGLE_PUBLIC_ORIGIN.replace(/\/$/, '') : 'https://mingle.cards';
  if (!Array.isArray(payload?.events) || payload.events.length > 100) return json(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
  try { for (const event of payload.events) {
    if (event?.source?.type !== 'user') continue;
    const lineUserId = text(event?.source?.userId, 64); const eventId = text(event?.webhookEventId, 128);
    if (!lineUserId || !eventId) continue;
    const type = event.type === 'unfollow' ? 'unfollow' : event.type === 'follow' ? 'follow' : event.type === 'accountLink' ? 'account_link' : event.type === 'message' && event.message?.type === 'text' && /^停止$/.test(event.message.text) ? 'stop' : event.type === 'message' && event.message?.type === 'text' && /^再開$/.test(event.message.text) ? 'resume' : event.type === 'message' && event.message?.type === 'text' && /^連携$/.test(event.message.text) ? 'link_request' : 'ignored';
    if (type === 'account_link' && event.link?.nonce) {
      await rest(service, '/rest/v1/rpc/line_record_account_link_event', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_line_user_id: lineUserId, p_nonce_hash: hash(event.link.nonce), p_result: event.link.result || '' }) }, fetchImpl);
      continue;
    }
    if ((type === 'follow' || type === 'link_request') && event.replyToken) {
      const claimToken = randomBytes(24).toString('hex');
      const claimed = await rest(service, '/rest/v1/rpc/line_claim_webhook_event', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_event_type: type, p_line_user_id: lineUserId, p_claim_token: claimToken, p_payload: null }) }, fetchImpl);
      if (claimed === 'busy') throw Object.assign(new Error('LINE_WEBHOOK_BUSY'), { status: 503 });
      if (claimed !== 'claimed') continue;
      const existing = await rest(service, '/rest/v1/rpc/line_follow_existing', { method: 'POST', body: JSON.stringify({ p_line_user_id: lineUserId }) }, fetchImpl);
      if (existing === 'active' || existing === 'active_paused') {
        const statusText = existing === 'active_paused' ? '連携済みです。配信停止中のため、再開はアプリから行ってください。' : 'すでにMingleアカウントと連携済みです。';
        const marked = await rest(service, '/rest/v1/rpc/line_mark_webhook_reply_started', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_claim_token: claimToken }) }, fetchImpl);
        if (marked !== true) throw Object.assign(new Error('LINE_WEBHOOK_BUSY'), { status: 503 });
        const replied = await replyLineMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: statusText }], config: line, fetchImpl });
        await rest(service, '/rest/v1/rpc/line_finalize_webhook_event', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_claim_token: claimToken, p_terminal: true }) }, fetchImpl);
        if (!replied.ok) continue;
        continue;
      }
      const issued = await issueLineLinkToken({ lineUserId, config: line, fetchImpl });
      if (!issued.ok) {
        await rest(service, '/rest/v1/rpc/line_release_webhook_event', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_claim_token: claimToken }) }, fetchImpl);
        throw Object.assign(new Error('LINE_LINK_TOKEN_UNAVAILABLE'), { status: 503 });
      }
      const lineToken = issued.linkToken; const setupToken = randomBytes(32).toString('base64url');
      const expires = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
      await rest(service, '/rest/v1/rpc/line_create_link_attempt', { method: 'POST', body: JSON.stringify({ p_expected_line_user_id: lineUserId, p_line_link_token_hash: hash(lineToken), p_setup_token_hash: hash(setupToken), p_expires_at: expires }) }, fetchImpl);
      const link = `${origin}/daily.html#link=${encodeURIComponent(lineToken)}&setup=${encodeURIComponent(setupToken)}`;
      const marked = await rest(service, '/rest/v1/rpc/line_mark_webhook_reply_started', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_claim_token: claimToken }) }, fetchImpl);
      if (marked !== true) throw Object.assign(new Error('LINE_WEBHOOK_BUSY'), { status: 503 });
      const replied = await replyLineMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `Mingleアカウント連携はこちら（10分以内）\n${link}` }], config: line, fetchImpl });
      await rest(service, '/rest/v1/rpc/line_finalize_webhook_event', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_claim_token: claimToken, p_terminal: !replied.ok }) }, fetchImpl);
    } else if ((type === 'stop' || type === 'resume') && event.replyToken) {
      const recorded = await rest(service, '/rest/v1/rpc/line_record_webhook_event', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_event_type: type, p_line_user_id: lineUserId, p_payload: null }) }, fetchImpl);
      if (recorded === false) continue;
      await replyLineMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: type === 'stop' ? '1日1問を停止しました。' : '1日1問を再開しました。' }], config: line, fetchImpl });
    } else {
      const recorded = await rest(service, '/rest/v1/rpc/line_record_webhook_event', { method: 'POST', body: JSON.stringify({ p_event_id: eventId, p_event_type: type, p_line_user_id: lineUserId, p_payload: null }) }, fetchImpl);
      if (recorded === false) continue;
    }
  } } catch { return json(res, 503, { error: 'LINE_WEBHOOK_UNAVAILABLE' }); }
  return json(res, 200, { received: true });
  };
}

export default createLineWebhookHandler();
