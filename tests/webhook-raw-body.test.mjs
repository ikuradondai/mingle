import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { rawBodyWithLimit } from '../server-side/http.mjs';
import { verifyLineWebhookSignature } from '../server-side/line-messaging.mjs';

const secret = 'line-secret';

test('raw webhook bytes preserve whitespace and Japanese characters for HMAC', async () => {
  const raw = Buffer.from('{"events": [ { "type": "message", "text": "こんにちは  世界" } ]}\n', 'utf8');
  const req = { async *[Symbol.asyncIterator]() { yield raw.subarray(0, 12); yield raw.subarray(12); } };
  const received = await rawBodyWithLimit(req, 4096);
  assert.deepEqual(received, raw);
  const signature = createHmac('sha256', secret).update(raw).digest('base64');
  assert.equal(verifyLineWebhookSignature(received, signature, secret), true);
  const parsed = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))));
  assert.equal(verifyLineWebhookSignature(parsed, signature, secret), false);
});

test('parsed request.body fails closed instead of reconstructing signed bytes', async () => {
  const req = { body: { events: [{ type: 'message', text: 'こんにちは' }] } };
  await assert.rejects(() => rawBodyWithLimit(req, 4096), (error) => error.code === 'RAW_BODY_UNAVAILABLE' && error.status === 400);
});
