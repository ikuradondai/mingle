import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { issueLineLinkToken, pushLineMessage, readLineConfig, verifyLineWebhookSignature } from '../server-side/line-messaging.mjs';

const secret = 'line-test-channel-secret';
const token = 'line-test-access-token';
const retryKey = '123e4567-e89b-12d3-a456-426614174000';
const config = { configured: true, channelSecret: secret, channelAccessToken: token, apiBaseUrl: 'https://api.line.test' };
const response = (status, headers = {}, body = '') => new Response(body, { status, headers });

test('LINE config is server-only and reports readiness without exposing values', () => {
  const ready = readLineConfig({ LINE_CHANNEL_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: token });
  assert.equal(ready.configured, true);
  assert.equal(ready.apiBaseUrl, 'https://api.line.me');
  assert.equal(readLineConfig({}).configured, false);
  assert.throws(() => readLineConfig({ LINE_API_BASE_URL: 'http://insecure.test' }), /invalid/i);
});

test('webhook signature uses exact raw body and rejects malformed or wrong-length signatures', () => {
  const raw = '{"events":[{"type":"follow"}]}';
  const signature = createHmac('sha256', secret).update(raw).digest('base64');
  assert.equal(verifyLineWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyLineWebhookSignature(`${raw} `, signature, secret), false);
  assert.equal(verifyLineWebhookSignature(raw, 'not-base64', secret), false);
  assert.equal(verifyLineWebhookSignature(raw, `!${signature.slice(1)}`, secret), false);
  assert.equal(verifyLineWebhookSignature(raw, Buffer.alloc(0).toString('base64'), secret), false);
});

test('push sends destination, messages and stable retry key without leaking response body', async () => {
  let call;
  const result = await pushLineMessage({ config, destination: 'Cgroup', messages: [{ type: 'text', text: '今日の問い' }], retryKey, fetchImpl: async (url, options) => {
    call = { url, options };
    return response(200, { 'x-line-request-id': 'req-1' }, '{"secret":"must-not-return"}');
  } });
  assert.deepEqual(result, { ok: true, status: 200, requestId: 'req-1', retryAccepted: false });
  assert.equal(call.url, 'https://api.line.test/v2/bot/message/push');
  assert.equal(call.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(call.options.headers['X-Line-Retry-Key'], retryKey);
  assert.deepEqual(JSON.parse(call.options.body), { to: 'Cgroup', messages: [{ type: 'text', text: '今日の問い' }] });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('only confirmed duplicate retry-key 409 is accepted, while other failures stay structured and non-retrying', async () => {
  let calls = 0;
  const duplicate = await pushLineMessage({ config, destination: 'Uuser', messages: [{ type: 'text', text: 'x' }], retryKey, fetchImpl: async () => { calls += 1; return response(409, { 'x-line-request-id': 'req-dup', 'x-line-accepted-request-id': 'req-first' }, 'private error'); } });
  assert.deepEqual(duplicate, { ok: true, status: 409, requestId: 'req-dup', acceptedRequestId: 'req-first', retryAccepted: true });
  assert.equal(calls, 1);
  const conflict = await pushLineMessage({ config, destination: 'Uuser', messages: [{ type: 'text', text: 'x' }], retryKey, fetchImpl: async () => response(409, { 'x-line-request-id': 'req-conflict' }, 'private error') });
  assert.deepEqual(conflict, { ok: false, failure: { code: 'HTTP_409', message: 'LINE push was not accepted' }, status: 409, requestId: 'req-conflict', retryAccepted: false, deliveryUncertain: false, retryable: false });
  const limited = await pushLineMessage({ config, destination: 'Uuser', messages: [{ type: 'text', text: 'x' }], retryKey, fetchImpl: async () => response(429, {}, 'private error') });
  assert.deepEqual(limited, { ok: false, failure: { code: 'RATE_LIMITED', message: 'LINE push was not accepted' }, status: 429, requestId: null, retryAccepted: false, deliveryUncertain: false, retryable: false });
  const serverError = await pushLineMessage({ config, destination: 'Uuser', messages: [{ type: 'text', text: 'x' }], retryKey, fetchImpl: async () => response(503, {}, 'private error') });
  assert.equal(serverError.deliveryUncertain, true);
  assert.equal(serverError.retryable, true);
  const unauthorized = await pushLineMessage({ config, destination: 'Uuser', messages: [{ type: 'text', text: 'x' }], retryKey, fetchImpl: async () => response(401, {}, '{"message":"token secret"}') });
  assert.equal(unauthorized.failure.code, 'HTTP_401');
  assert.equal(JSON.stringify(unauthorized).includes('token secret'), false);
});

test('push validates inputs, bounds timeout, and does not expose network errors', async () => {
  assert.equal((await pushLineMessage({ config, destination: '', messages: [], retryKey })).failure.code, 'INVALID_DESTINATION');
  assert.equal((await pushLineMessage({ config, destination: 'U', messages: [{ type: 'text', text: 'x' }], retryKey: 'bad' })).failure.code, 'INVALID_RETRY_KEY');
  const result = await pushLineMessage({ config, destination: 'U', messages: [{ type: 'text', text: 'x' }], retryKey, timeoutMs: 0, fetchImpl: async (_url, { signal }) => { await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }); } });
  assert.deepEqual(result, { ok: false, failure: { code: 'TIMEOUT', message: 'LINE request timed out' }, deliveryUncertain: true, retryable: true });
  let networkCalls = 0;
  const network = await pushLineMessage({ config, destination: 'U', messages: [{ type: 'text', text: 'x' }], retryKey, fetchImpl: async () => { networkCalls += 1; throw new Error('socket failed'); } });
  assert.deepEqual(network, { ok: false, failure: { code: 'NETWORK_ERROR', message: 'LINE request failed' }, deliveryUncertain: true, retryable: true });
  assert.equal(networkCalls, 1);
  const unavailable = await pushLineMessage({ config: { configured: false }, destination: 'U', messages: [{ type: 'text', text: 'x' }], retryKey });
  assert.equal(unavailable.failure.code, 'LINE_NOT_CONFIGURED');
});

test('account linking requests the official LINE link token endpoint', async () => {
  let request;
  const result = await issueLineLinkToken({ config, lineUserId: 'U12345678901234567890', fetchImpl: async (url, options) => { request = { url, options }; return response(200, {}, JSON.stringify({ linkToken: 'line-link-token' })); } });
  assert.deepEqual(result, { ok: true, linkToken: 'line-link-token', requestId: null });
  assert.equal(request.url, 'https://api.line.test/v2/bot/user/U12345678901234567890/linkToken');
  assert.equal(request.options.method, 'POST');
});
