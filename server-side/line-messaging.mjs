import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_API_BASE_URL = 'https://api.line.me';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TIMEOUT_MS = 30000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

/** Read server-only LINE settings without logging or returning them in API payloads. */
export function readLineConfig(env = process.env) {
  const channelSecret = text(env.LINE_CHANNEL_SECRET);
  const channelAccessToken = text(env.LINE_CHANNEL_ACCESS_TOKEN);
  const apiBaseUrl = text(env.LINE_API_BASE_URL) || DEFAULT_API_BASE_URL;
  let apiBase;
  try {
    const parsed = new URL(apiBaseUrl);
    if (parsed.protocol !== 'https:') throw new Error('LINE API base must use HTTPS');
    apiBase = parsed.href.replace(/\/$/, '');
  } catch {
    throw new Error('LINE API base is invalid');
  }
  return { configured: Boolean(channelSecret && channelAccessToken), channelSecret, channelAccessToken, apiBaseUrl: apiBase };
}

/** Verify LINE's HMAC-SHA256 signature against the exact, unparsed webhook body. */
export function verifyLineWebhookSignature(rawBody, signature, channelSecret) {
  const secret = text(channelSecret);
  const supplied = text(signature);
  if (!secret || !supplied || (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody))) return false;
  let actual;
  if (supplied.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(supplied)) return false;
  try { actual = Buffer.from(supplied, 'base64'); } catch { return false; }
  if (actual.toString('base64') !== supplied) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function boundedTimeout(value) {
  const timeout = Number(value ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(timeout) ? Math.min(Math.max(Math.floor(timeout), 1), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
}

async function drainResponse(response) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) { try { await response.body?.cancel?.(); } catch {} return; }
  if (!response.body?.getReader) { await response.text?.(); return; }
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (total <= MAX_RESPONSE_BYTES) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value?.byteLength || 0;
    }
  } finally { try { await reader.cancel(); } catch {} }
}

function requestId(response) {
  return text(response.headers?.get?.('x-line-request-id')) || null;
}

function acceptedRequestId(response) {
  return text(response.headers?.get?.('x-line-accepted-request-id')) || null;
}

function failure(code, message, extra = {}) { return { ok: false, failure: { code, message }, ...extra }; }

/**
 * Send one LINE push request. This function deliberately never retries by itself.
 * The caller must reuse the same retryKey, body and destination when retrying a
 * timeout/5xx. LINE's duplicate retry-key 409 is reported as accepted.
 */
export async function pushLineMessage({ destination, messages, retryKey, config = readLineConfig(), fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const to = text(destination);
  if (!to) return failure('INVALID_DESTINATION', 'destination is required');
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 5) return failure('INVALID_MESSAGES', 'messages must contain 1 to 5 items');
  if (messages.some((message) => !message || typeof message !== 'object' || Array.isArray(message))) return failure('INVALID_MESSAGES', 'messages must contain objects');
  if (!UUID.test(text(retryKey))) return failure('INVALID_RETRY_KEY', 'retryKey must be a UUID');
  if (!config?.configured || !config.channelAccessToken) return failure('LINE_NOT_CONFIGURED', 'LINE messaging is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  let response;
  try {
    response = await fetchImpl(`${config.apiBaseUrl}/v2/bot/message/push`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.channelAccessToken}`,
        'Content-Type': 'application/json',
        'X-Line-Retry-Key': text(retryKey)
      },
      body: JSON.stringify({ to, messages })
    });
    const status = Number(response.status) || 0;
    const id = requestId(response);
    const acceptedId = acceptedRequestId(response);
    await drainResponse(response);
    if (status >= 200 && status < 300) return { ok: true, status, requestId: id, retryAccepted: false };
    if (status === 409 && acceptedId) return { ok: true, status, requestId: id, acceptedRequestId: acceptedId, retryAccepted: true };
    return failure(status === 429 ? 'RATE_LIMITED' : `HTTP_${status || 'UNKNOWN'}`, 'LINE push was not accepted', { status, requestId: id, retryAccepted: false, deliveryUncertain: status >= 500, retryable: status >= 500 });
  } catch (error) {
    return failure(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', error?.name === 'AbortError' ? 'LINE request timed out' : 'LINE request failed', { deliveryUncertain: true, retryable: true });
  } finally { clearTimeout(timer); }
}

export async function replyLineMessage({ replyToken, messages, config = readLineConfig(), fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const token = text(replyToken);
  if (!token) return failure('INVALID_REPLY_TOKEN', 'replyToken is required');
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 5) return failure('INVALID_MESSAGES', 'messages must contain 1 to 5 items');
  if (!config?.configured || !config.channelAccessToken) return failure('LINE_NOT_CONFIGURED', 'LINE messaging is not configured');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    const response = await fetchImpl(`${config.apiBaseUrl}/v2/bot/message/reply`, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${config.channelAccessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ replyToken: token, messages }) });
    const status = Number(response.status) || 0; const id = requestId(response); await drainResponse(response);
    if (status >= 200 && status < 300) return { ok: true, status, requestId: id };
    return failure(status === 429 ? 'RATE_LIMITED' : `HTTP_${status || 'UNKNOWN'}`, 'LINE reply was not accepted', { status, requestId: id, deliveryUncertain: status >= 500, retryable: false });
  } catch (error) { return failure(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', error?.name === 'AbortError' ? 'LINE request timed out' : 'LINE request failed', { deliveryUncertain: true, retryable: false }); }
  finally { clearTimeout(timer); }
}

export async function issueLineLinkToken({ lineUserId, config = readLineConfig(), fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const userId = text(lineUserId);
  if (!userId) return failure('INVALID_LINE_USER', 'lineUserId is required');
  if (!config?.configured || !config.channelAccessToken) return failure('LINE_NOT_CONFIGURED', 'LINE messaging is not configured');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    const response = await fetchImpl(`${config.apiBaseUrl}/v2/bot/user/${encodeURIComponent(userId)}/linkToken`, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${config.channelAccessToken}`, Accept: 'application/json' } });
    const status = Number(response.status) || 0; const id = requestId(response); const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > 16 * 1024) { try { await response.body?.cancel?.(); } catch {} return failure('LINE_RESPONSE_TOO_LARGE', 'LINE response was too large', { status, requestId: id }); }
    let data = null; try { data = await response.json(); } catch {}
    if (!response.ok || typeof data?.linkToken !== 'string' || !data.linkToken) return failure(response.status === 429 ? 'RATE_LIMITED' : `HTTP_${status || 'UNKNOWN'}`, 'LINE link token was not issued', { status, requestId: id, retryable: false });
    return { ok: true, linkToken: data.linkToken, requestId: id };
  } catch (error) { return failure(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', error?.name === 'AbortError' ? 'LINE request timed out' : 'LINE request failed', { deliveryUncertain: true, retryable: false }); }
  finally { clearTimeout(timer); }
}

export const lineMessagingLimits = Object.freeze({ maxMessagesPerPush: 5, maxResponseBytes: MAX_RESPONSE_BYTES, maxTimeoutMs: MAX_TIMEOUT_MS });
