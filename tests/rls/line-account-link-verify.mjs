import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createDailyApi } from '../../server-side/daily-api.mjs';
import { createLineWebhookHandler } from '../../api/line/webhook.js';

const owner = '11111111-1111-4111-8111-111111111111';
const lineUser = 'U12345678901234567890123456789012';
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', LINE_CHANNEL_SECRET: 'line-secret', LINE_CHANNEL_ACCESS_TOKEN: 'line-access', LINE_API_BASE_URL: 'https://api.line.test', MINGLE_PUBLIC_ORIGIN: 'https://mingle.test' };
const db = new PGlite(); await db.waitReady;
await db.exec("create schema auth; create table auth.users(id uuid primary key,email text); create role anon; create role authenticated; create role service_role bypassrls; create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
await db.exec(await readFile(new URL('../../supabase/migrations/202610020001_accounts.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/202610120001_daily_line.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/202610120002_daily_line_repairs.sql', import.meta.url), 'utf8'));
const testNow = new Date((await db.query('select now()')).rows[0].now.getTime());
await db.query('insert into auth.users(id,email) values($1,$2)', [owner, 'owner@test']); await db.exec('set role service_role');

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status });
async function rpc(name, body) {
  if (name === 'line_claim_webhook_event') return (await db.query("select public.line_claim_webhook_event($1,$2,$3,$4,$5) as value", [body.p_event_id, body.p_event_type, body.p_line_user_id, body.p_claim_token, body.p_payload || null])).rows[0].value;
  if (name === 'line_mark_webhook_reply_started') return (await db.query("select public.line_mark_webhook_reply_started($1,$2) as value", [body.p_event_id, body.p_claim_token])).rows[0].value;
  if (name === 'line_release_webhook_event') return (await db.query("select public.line_release_webhook_event($1,$2) as value", [body.p_event_id, body.p_claim_token])).rows[0].value;
  if (name === 'line_finalize_webhook_event') return (await db.query("select public.line_finalize_webhook_event($1,$2,$3) as value", [body.p_event_id, body.p_claim_token, body.p_terminal === true])).rows[0].value;
  if (name === 'line_follow_existing') return (await db.query("select public.line_follow_existing($1) as value", [body.p_line_user_id])).rows[0].value;
  if (name === 'line_create_link_attempt') return (await db.query("select * from public.line_create_link_attempt($1,$2,$3,$4)", [body.p_expected_line_user_id, body.p_line_link_token_hash, body.p_setup_token_hash, body.p_expires_at])).rows[0];
  if (name === 'line_record_webhook_event') return (await db.query("select public.line_record_webhook_event($1,$2,$3,$4) as value", [body.p_event_id, body.p_event_type, body.p_line_user_id, body.p_payload || null])).rows[0].value;
  if (name === 'line_bind_link_attempt') return (await db.query("select * from public.line_bind_link_attempt($1,$2,$3,$4)", [body.p_setup_token_hash, body.p_user_id, body.p_nonce_hash, body.p_line_link_token_hash])).rows[0];
  if (name === 'line_record_account_link_event') return (await db.query("select * from public.line_record_account_link_event($1,$2,$3,$4)", [body.p_event_id, body.p_line_user_id, body.p_nonce_hash, body.p_result])).rows[0] || null;
  throw new Error(`unexpected rpc ${name}`);
}
function adapter(lineToken, issueState = { calls: 0, failFirst: false }) { return async (url, options = {}) => {
  if (url.endsWith('/auth/v1/user')) return jsonResponse({ id: owner, is_anonymous: false });
  if (url.startsWith(env.LINE_API_BASE_URL) && url.endsWith('/linkToken')) { issueState.calls += 1; if (issueState.failFirst && issueState.calls === 1) return jsonResponse({ error: 'temporary' }, 503); return jsonResponse({ linkToken: lineToken }); }
  if (url.startsWith(env.LINE_API_BASE_URL) && url.endsWith('/message/reply')) return jsonResponse({});
  if (url.includes('/rest/v1/rpc/')) { try { return jsonResponse(await rpc(url.split('/').pop(), JSON.parse(options.body))); } catch (error) { console.error('RPC_FAIL', url.split('/').pop(), error.message); throw error; } }
  throw new Error(`unexpected request ${url}`);
}; }
function req(payload) { const raw = Buffer.from(JSON.stringify(payload)); return { method: 'POST', headers: { 'x-line-signature': createHmac('sha256', env.LINE_CHANNEL_SECRET).update(raw).digest('base64') }, async *[Symbol.asyncIterator]() { yield raw; } }; }
function res() { return { statusCode: 0, body: null, writeHead(status) { this.statusCode = status; }, end(value) { this.body = JSON.parse(value); } }; }

const lineToken = 'REAL-LINE-LINK-TOKEN'; const fetchImpl = adapter(lineToken);
const webhook = createLineWebhookHandler({ env, fetchImpl, now: () => testNow });
const follow = { type: 'follow', webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA1', replyToken: 'reply-1', source: { type: 'user', userId: lineUser } };
const followRes = res(); await webhook(req({ events: [follow] }), followRes); assert.equal(followRes.statusCode, 200, JSON.stringify(followRes.body));
const message = followRes.body; assert.equal(message.received, true);
// The reply body is captured by the adapter below through the second request.
let setupToken = null; let replyBody = null;
const captureFetch = async (url, options = {}) => { if (url.endsWith('/message/reply')) { replyBody = JSON.parse(options.body); const match = replyBody.messages[0].text.match(/#link=[^&]+&setup=([^\n]+)/); setupToken = decodeURIComponent(match[1]); return jsonResponse({}); } return fetchImpl(url, options); };
// Re-run with capture because the first handler used the same real mock but did not expose reply content.
await db.query("delete from public.line_webhook_events"); await db.query("delete from public.line_link_attempts");
const webhookCapture = createLineWebhookHandler({ env, fetchImpl: captureFetch, now: () => testNow });
const second = res(); await webhookCapture(req({ ...{ events: [{ ...follow, webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA2' }] } }), second); assert.equal(second.statusCode, 200); assert.ok(setupToken);
const api = createDailyApi({ env, random: () => 'fresh-integration-nonce', fetchImpl });
const bound = await api.bindLine({ id: owner, authorization: 'Bearer owner' }, { setupToken, lineToken });
const nonce = new URL(bound.redirectUrl).searchParams.get('nonce'); assert.equal(nonce, 'fresh-integration-nonce');
const callback = { type: 'accountLink', webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA3', source: { type: 'user', userId: lineUser }, link: { result: 'ok', nonce } };
const callbackRes = res(); await webhookCapture(req({ events: [callback] }), callbackRes); assert.equal(callbackRes.statusCode, 200);
const linked = (await db.query('select user_id,status from public.line_account_links where line_user_id=$1', [lineUser])).rows[0]; assert.equal(linked.user_id, owner); assert.equal(linked.status, 'active');
const replay = res(); await webhookCapture(req({ events: [callback] }), replay); assert.equal(replay.statusCode, 200);
const wrongResult = (await db.query("select * from public.line_record_account_link_event('01JAAAAAAAAAAAAAAAAAAAAAA4',$1,'wrong-nonce','ok')", [lineUser])).rows; assert.equal(wrongResult[0]?.user_id ?? null, null);
const expiredLine = 'U55555555555555555555555555555555';
await db.query("select * from public.line_create_link_attempt($1,'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr','ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss',now()+interval '5 minutes')", [expiredLine]);
await db.query("select * from public.line_bind_link_attempt('ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss',$1,'tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt','rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr')", [owner]);
await db.query("update public.line_link_attempts set expires_at=now()-interval '1 second' where setup_token_hash='ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss'");
const expiredResult = (await db.query("select * from public.line_record_account_link_event('01JAAAAAAAAAAAAAAAAAAAAAA9',$1,'tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt','ok')", [expiredLine])).rows[0]; assert.equal(expiredResult?.user_id ?? null, null);
const mismatchExpected = 'U66666666666666666666666666666666'; const mismatchActual = 'U77777777777777777777777777777777';
await db.query("select * from public.line_create_link_attempt($1,'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu','vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',now()+interval '5 minutes')", [mismatchExpected]);
await db.query("select * from public.line_bind_link_attempt('vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',$1,'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww','uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu')", [owner]);
const mismatchResult = (await db.query("select * from public.line_record_account_link_event('01JAAAAAAAAAAAAAAAAAAAAAA0',$1,'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww','ok')", [mismatchActual])).rows[0]; assert.equal(mismatchResult?.user_id ?? null, null);
const failedResult = (await db.query("select * from public.line_record_account_link_event('01JAAAAAAAAAAAAAAAAAAAAAB0',$1,'unused-nonce','failed')", [expiredLine])).rows[0]; assert.equal(failedResult?.user_id ?? null, null);
const claim1 = (await db.query("select public.line_claim_webhook_event('01JAAAAAAAAAAAAAAAAAAAAAA5','follow',$1,'claim-a',null) as value", [lineUser])).rows[0].value;
const claimBusy = (await db.query("select public.line_claim_webhook_event('01JAAAAAAAAAAAAAAAAAAAAAA5','follow',$1,'claim-b',null) as value", [lineUser])).rows[0].value;
assert.equal(claim1, 'claimed'); assert.equal(claimBusy, 'busy');
assert.equal((await db.query("select public.line_mark_webhook_reply_started('01JAAAAAAAAAAAAAAAAAAAAAA5','claim-a') as value")).rows[0].value, true);
await db.query("update public.line_webhook_events set claim_until=now()-interval '1 second' where event_id='01JAAAAAAAAAAAAAAAAAAAAAA5'");
assert.equal((await db.query("select public.line_claim_webhook_event('01JAAAAAAAAAAAAAAAAAAAAAA5','follow',$1,'claim-c',null) as value", [lineUser])).rows[0].value, 'done');
const stopReq = req({ events: [{ type: 'message', webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA6', replyToken: 'stop-reply', source: { type: 'user', userId: lineUser }, message: { type: 'text', text: '停止' } }] }); const stopRes = res(); await webhookCapture(stopReq, stopRes); assert.equal(stopRes.statusCode, 200);
assert.equal((await db.query('select delivery_paused from public.line_account_links where line_user_id=$1', [lineUser])).rows[0].delivery_paused, true);
const unfollowRes = res(); await webhookCapture(req({ events: [{ type: 'unfollow', webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA7', source: { type: 'user', userId: lineUser } }] }), unfollowRes); assert.equal(unfollowRes.statusCode, 200);
assert.equal((await db.query('select status,delivery_paused from public.line_account_links where line_user_id=$1', [lineUser])).rows[0].status, 'blocked');
const attemptsBeforeRecovery = (await db.query('select count(*)::int as n from public.line_link_attempts')).rows[0].n;
const recovery = res(); await webhookCapture(req({ events: [{ type: 'follow', webhookEventId: '01JAAAAAAAAAAAAAAAAAAAAAA8', replyToken: 'recover-reply', source: { type: 'user', userId: lineUser } }] }), recovery); assert.equal(recovery.statusCode, 200);
const recovered = (await db.query('select status,delivery_paused from public.line_account_links where line_user_id=$1', [lineUser])).rows[0]; assert.equal(recovered.status, 'active'); assert.equal(recovered.delivery_paused, true);
assert.equal((await db.query('select count(*)::int as n from public.line_link_attempts')).rows[0].n, attemptsBeforeRecovery);
console.log(JSON.stringify({ follow: true, actualLinkToken: true, bindRedirect: true, callbackActivated: true, replaySafe: true, wrongNonceRejected: true, claimBusy: true, replyFence: true, stopApplied: true, unfollowApplied: true, blockedFollowNoReissue: true }));
await db.close();
