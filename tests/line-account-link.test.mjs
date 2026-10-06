import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createDailyApi } from '../server-side/daily-api.mjs';
import { createLineWebhookHandler } from '../api/line/webhook.js';

const userId = '11111111-1111-4111-8111-111111111111';
const lineUserId = 'U12345678901234567890123456789012';
const env = {
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test', LINE_CHANNEL_SECRET: 'line-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-access', LINE_API_BASE_URL: 'https://api.line.test',
  MINGLE_PUBLIC_ORIGIN: 'https://mingle.test'
};
const response = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

function requestFor(payload, signature) {
  const raw = Buffer.from(JSON.stringify(payload));
  return { method: 'POST', headers: { 'x-line-signature': signature || createHmac('sha256', env.LINE_CHANNEL_SECRET).update(raw).digest('base64') }, async *[Symbol.asyncIterator]() { yield raw; } };
}
function result() { return { statusCode: 0, body: null, writeHead(status) { this.statusCode = status; }, end(value) { this.body = JSON.parse(value); } }; }

test('account link API returns LINE dialog redirect and callback activates only after official proof', async () => {
  const bindBodies = [];
  const api = createDailyApi({ env, random: () => 'fresh-nonce-value', fetchImpl: async (url, options = {}) => {
    if (url.endsWith('/auth/v1/user')) return response({ id: userId, is_anonymous: false });
    if (url.includes('/rpc/line_bind_link_attempt')) { bindBodies.push(JSON.parse(options.body)); return response({ id: 'attempt-1' }); }
    throw new Error(`unexpected API request ${url}`);
  } });
  const bound = await api.bindLine({ id: userId, authorization: 'Bearer user-token' }, { setupToken: 'setup-token', lineToken: 'LINE-TOKEN-REAL' });
  assert.match(bound.redirectUrl, /^https:\/\/access\.line\.me\/dialog\/bot\/accountLink\?/);
  const redirect = new URL(bound.redirectUrl);
  assert.equal(redirect.searchParams.get('linkToken'), 'LINE-TOKEN-REAL');
  assert.equal(redirect.searchParams.get('nonce'), 'fresh-nonce-value');
  assert.equal(bindBodies[0].p_user_id, userId);
  assert.notEqual(bindBodies[0].p_nonce_hash, 'fresh-nonce-value');

  let issueAttempt = 0; const rpcCalls = []; const replies = [];
  const webhook = createLineWebhookHandler({ env, now: () => new Date('2026-10-06T00:00:00Z'), fetchImpl: async (url, options = {}) => {
    if (url.includes('/v2/bot/user/') && url.endsWith('/linkToken')) {
      issueAttempt += 1;
      return issueAttempt === 1 ? response({ error: 'temporary' }, 503) : response({ linkToken: 'LINE-TOKEN-REAL' });
    }
    if (url.includes('/v2/bot/message/reply')) { replies.push(JSON.parse(options.body)); return response({}); }
    if (url.includes('/rest/v1/rpc/')) {
      const name = url.split('/').pop(); const body = JSON.parse(options.body); rpcCalls.push({ name, body });
      if (name === 'line_claim_webhook_event') return response('claimed');
      if (['line_release_webhook_event', 'line_mark_webhook_reply_started', 'line_finalize_webhook_event'].includes(name)) return response(true);
      return response({ ok: true });
    }
    throw new Error(`unexpected webhook request ${url}`);
  } });
  const follow = { type: 'follow', webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA1', replyToken: 'reply-1', source: { type: 'user', userId: lineUserId } };
  let res = result(); await webhook(requestFor({ events: [follow] }), res);
  assert.equal(res.statusCode, 503); assert.equal(issueAttempt, 1); assert.equal(rpcCalls.filter((call) => call.name === 'line_claim_webhook_event').length, 1); assert.equal(rpcCalls.filter((call) => call.name === 'line_release_webhook_event').length, 1);
  res = result(); await webhook(requestFor({ events: [follow] }), res);
  assert.equal(res.statusCode, 200); assert.equal(issueAttempt, 2);
  assert.equal(rpcCalls.some((call) => call.name === 'line_create_link_attempt'), true);
  assert.equal(rpcCalls.some((call) => call.name === 'line_finalize_webhook_event'), true);
  assert.equal(replies.length, 1);
  assert.match(replies[0].messages[0].text, /#link=LINE-TOKEN-REAL&setup=/);

  const accountLink = { type: 'accountLink', webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA2', source: { type: 'user', userId: lineUserId }, link: { result: 'ok', nonce: redirect.searchParams.get('nonce') } };
  res = result(); await webhook(requestFor({ events: [accountLink] }), res);
  assert.equal(res.statusCode, 200);
  const callback = rpcCalls.find((call) => call.name === 'line_record_account_link_event');
  assert.equal(callback.body.p_line_user_id, lineUserId);
  assert.equal(callback.body.p_result, 'ok');
  assert.notEqual(callback.body.p_nonce_hash, callback.body.p_nonce);
});

test('webhook catches storage failure without exposing internals', async () => {
  const webhook = createLineWebhookHandler({ env, fetchImpl: async (url) => {
    if (url.includes('/v2/bot/user/')) return response({ linkToken: 'token' });
    throw new Error('secret database stack');
  } });
  const res = result(); await webhook(requestFor({ events: [{ type: 'follow', webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA3', replyToken: 'r', source: { type: 'user', userId: lineUserId } }] }), res);
  assert.equal(res.statusCode, 503); assert.deepEqual(res.body, { error: 'LINE_WEBHOOK_UNAVAILABLE' });
});
