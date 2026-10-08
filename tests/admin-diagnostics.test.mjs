import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function run(extra, fetchMode = 'success', cookieMode = 'normal', input = { password: 'p'.repeat(32) }) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    process.env.NODE_ENV = 'production'; process.env.VERCEL = '1';
    for (const key of ['ADMIN_PASSWORD','ADMIN_SESSION_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN']) delete process.env[key];
    Object.assign(process.env, ${JSON.stringify(extra)});
    let redisCalls = 0;
    globalThis.fetch = async () => { redisCalls += 1; return ${fetchMode === 'success' ? "new Response(JSON.stringify([{result:1}]), {status:200})" : "new Response('failure', {status:503})"}; };
    const { sessionHandler } = await import('./server-side/admin-api.mjs?diagnostic=' + Date.now());
    const req = { method: 'POST', url: '/api/admin/session', headers: {'content-type':'application/json'}, body: ${JSON.stringify(input)} };
    let status; const headers = {};
    const res = { writeHead(code) { status = code; }, setHeader(name, value) { if (${JSON.stringify(cookieMode)} === 'throw' && name === 'Set-Cookie') throw new Error('cookie failure secret marker'); headers[name] = value; }, end() {} };
    await sessionHandler(req, res);
    console.log(JSON.stringify({status, hasCookie: Boolean(headers['Set-Cookie']), redisCalls}));
  `], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { result: JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), stderr: result.stderr };
}

test('admin diagnostics classify configuration without exposing secrets', () => {
  const missing = run({});
  assert.equal(missing.result.status, 503);
  assert.match(missing.stderr, /admin_session_unavailable reason=config_missing:password/);
  assert.doesNotMatch(missing.stderr, /p{32}|secret marker/);

  const missingInvalid = run({}, 'success', 'normal', {});
  assert.equal(missingInvalid.result.status, 503);
  assert.equal(missingInvalid.result.redisCalls, 0);

  const missingSecret = run({ ADMIN_PASSWORD: 'p'.repeat(32) });
  assert.equal(missingSecret.result.status, 503);
  assert.match(missingSecret.stderr, /reason=config_missing:session_secret/);
  assert.doesNotMatch(missingSecret.stderr, /p{32}/);

  const weak = run({ ADMIN_PASSWORD: 'p'.repeat(8), ADMIN_SESSION_SECRET: 's'.repeat(32), UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'opaque' });
  assert.equal(weak.result.status, 503);
  assert.match(weak.stderr, /reason=config_weak:password/);
  assert.doesNotMatch(weak.stderr, /p{8}|s{32}|opaque/);

  const weakSecret = run({ ADMIN_PASSWORD: 'p'.repeat(32), ADMIN_SESSION_SECRET: 's'.repeat(8), UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'opaque' });
  assert.equal(weakSecret.result.status, 503);
  assert.match(weakSecret.stderr, /reason=config_weak:session_secret/);
  assert.doesNotMatch(weakSecret.stderr, /p{32}|s{8}|opaque/);

  const unconfigured = run({ ADMIN_PASSWORD: 'p'.repeat(32), ADMIN_SESSION_SECRET: 's'.repeat(32) });
  assert.equal(unconfigured.result.status, 503);
  assert.match(unconfigured.stderr, /reason=store_unconfigured/);
});

test('admin diagnostics distinguish Redis failure, success, and signing failure', () => {
  const failed = run({ ADMIN_PASSWORD: 'p'.repeat(32), ADMIN_SESSION_SECRET: 's'.repeat(32), UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'opaque' }, 'failure');
  assert.equal(failed.result.status, 503);
  assert.match(failed.stderr, /reason=store_unavailable/);
  assert.doesNotMatch(failed.stderr, /redis\.invalid|opaque|failure/);

  const success = run({ ADMIN_PASSWORD: 'p'.repeat(32), ADMIN_SESSION_SECRET: 's'.repeat(32), UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'opaque' });
  assert.deepEqual(success.result, { status: 200, hasCookie: true, redisCalls: 1 });
  assert.equal(success.stderr, '');

  const invalid = run({ ADMIN_PASSWORD: 'p'.repeat(32), ADMIN_SESSION_SECRET: 's'.repeat(32), UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'opaque' }, 'success', 'normal', {});
  assert.deepEqual(invalid.result, { status: 400, hasCookie: false, redisCalls: 0 });
  assert.equal(invalid.stderr, '');

  const signing = run({ ADMIN_PASSWORD: 'p'.repeat(32), ADMIN_SESSION_SECRET: 's'.repeat(32), UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'opaque' }, 'success', 'throw');
  assert.equal(signing.result.status, 503);
  assert.match(signing.stderr, /reason=session_sign_failed/);
  assert.doesNotMatch(signing.stderr, /cookie failure secret marker|p{32}|s{32}/);
});
