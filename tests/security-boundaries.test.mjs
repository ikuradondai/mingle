import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function child(source, extra = {}, keepRedis = false) {
  const env = { ...process.env, ...extra };
  if (!keepRedis) { delete env.UPSTASH_REDIS_REST_URL; delete env.UPSTASH_REDIS_REST_TOKEN; delete env.KV_REST_API_URL; delete env.KV_REST_API_TOKEN; }
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

test('production cookie flags allow configured short password and keep weak session secret closed', () => {
  const result = child(`
    delete process.env.NODE_ENV; process.env.VERCEL='1'; process.env.ADMIN_SESSION_SECRET='s'.repeat(32); process.env.ADMIN_PASSWORD='short'; process.env.ANALYTICS_LOCAL_STORE='0'; process.env.UPSTASH_REDIS_REST_URL='https://fake.invalid'; process.env.UPSTASH_REDIS_REST_TOKEN='opaque-token';
    globalThis.fetch=async()=>new Response(JSON.stringify([{result:1}]),{status:200});
    const { setCookie } = await import('./server-side/http.mjs'); const { sessionHandler } = await import('./server-side/admin-api.mjs');
    const headers={}; setCookie({setHeader(k,v){headers[k]=v}}, 'opaque-test-token', 10);
    async function login(password){ const req={method:'POST',url:'/api/admin/session',headers:{'content-type':'application/json'},body:{password}}; let status; const out={}; const res={writeHead(c,h){status=c;Object.assign(out,h||{})},setHeader(k,v){out[k]=v},end(){}}; await sessionHandler(req,res); return status; }
    const strong='a'.repeat(32); process.env.ADMIN_PASSWORD=strong; const baseline=await login(strong); process.env.ADMIN_PASSWORD='short'; const shortPassword=await login('short'); const wrongPassword=await login('wrong'); process.env.ADMIN_SESSION_SECRET='short'; const weakSecret=await login('short');
    console.log(JSON.stringify({secure:String(headers['Set-Cookie']).includes('Secure'), strict:String(headers['Set-Cookie']).includes('SameSite=Strict'), path:String(headers['Set-Cookie']).includes('Path=/'), host:String(headers['Set-Cookie']).startsWith('__Host-mingle_admin='), httpOnly:String(headers['Set-Cookie']).includes('HttpOnly'), noDomain:!String(headers['Set-Cookie']).includes('Domain='), baseline, shortPassword, wrongPassword, weakSecret}));
  `, {}, true);
  assert.deepEqual(result, { secure: true, strict: true, path: true, host: true, httpOnly: true, noDomain: true, baseline: 200, shortPassword: 200, wrongPassword: 401, weakSecret: 503 });
});

test('production Redis failure returns 503 from tracking rate limiter', () => {
  const result = child(`
    process.env.NODE_ENV='production'; process.env.ADMIN_SESSION_SECRET='test-secret'; process.env.UPSTASH_REDIS_REST_URL='https://redis.invalid'; process.env.UPSTASH_REDIS_REST_TOKEN='opaque';
    const { Readable } = await import('node:stream');
    globalThis.fetch=async()=>new Response('failure',{status:503});
    const { default: track }=await import('./api/track.js'); const req=Readable.from([Buffer.from(JSON.stringify({type:'page_view',pageId:'participants',eventId:'boundary-fault-1'}))]); req.method='POST'; req.url='/api/track'; req.headers={'content-type':'application/json'}; req.socket={remoteAddress:'test'}; let status; const res={writeHead(c){status=c},end(){}}; await track(req,res); console.log(JSON.stringify({status}));
  `, {}, true);
  assert.deepEqual(result, { status: 503 });
});

test('production rejects the legacy admin cookie', () => {
  const result = child(`
    delete process.env.NODE_ENV; process.env.VERCEL='1'; process.env.ADMIN_SESSION_SECRET='s'.repeat(32); process.env.ADMIN_PASSWORD='a'.repeat(32); process.env.UPSTASH_REDIS_REST_URL='https://fake.invalid'; process.env.UPSTASH_REDIS_REST_TOKEN='opaque-token';
    globalThis.fetch=async()=>new Response(JSON.stringify([{result:0}]),{status:200});
    const { sessionHandler } = await import('./server-side/admin-api.mjs'); const req={method:'GET',url:'/api/admin/session',headers:{cookie:'mingle_admin=opaque-legacy'}}; let status; const res={writeHead(code){status=code},end(){}}; await sessionHandler(req,res); console.log(JSON.stringify({status}));
  `, {}, true);
  assert.deepEqual(result, { status: 401 });
});

test('owner create limiter is owner scoped and rejects the eleventh request', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'security-boundary-'));
  process.env.NODE_ENV = 'test'; process.env.ANALYTICS_LOCAL_STORE = '1'; process.env.ANALYTICS_LOCAL_PATH = join(temp, 'analytics.json');
  process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  globalThis.fetch = async (url) => url.endsWith('/auth/v1/user') ? new Response(JSON.stringify({ id: 'owner-boundary' }), { status: 200 }) : new Response('[]', { status: 200 });
  const { createVenueService } = await import('../server-side/venues.mjs'); const service = createVenueService();
  const req = { headers: { authorization: 'Bearer opaque-user' } }; for (let i = 0; i < 10; i += 1) await service.rateOwner(req); await assert.rejects(() => service.rateOwner(req), (error) => error.status === 429);
});

test('group polling allows eight members and bounds token rotation by aggregate IP rate', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'group-boundary-'));
  process.env.NODE_ENV = 'test'; delete process.env.VERCEL; process.env.ANALYTICS_LOCAL_STORE = '1'; process.env.ANALYTICS_LOCAL_PATH = join(temp, 'analytics.json'); process.env.ADMIN_SESSION_SECRET = 's'.repeat(32);
  process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const roomId = '11111111-1111-4111-8111-111111111111';
  const room = { id: roomId, expires_at: new Date(Date.now() + 3600000).toISOString(), cards: [{ id: 'c1', text: 'x' }], status: 'lobby', cursor: 0, revision: 1, member_count: 8, host_user_id: 'owner', invite_hash: 'opaque' };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/group_rooms?')) return new Response(JSON.stringify([room]), { status: 200 });
    if (String(url).includes('/group_members?')) return new Response(JSON.stringify([{ id: 'member-1', display_name: 'member', role: 'member', adult_confirmed: false, joined_at: new Date().toISOString() }]), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const { default: group } = await import('../api/group.js');
  async function poll(token) { let status; const req = { method: 'GET', url: `/api/group/rooms/${roomId}`, headers: { 'x-group-member-token': token }, socket: { remoteAddress: '10.0.0.8' } }; const res = { writeHead(code) { status = code; }, end() {}, setHeader() {} }; await group(req, res); return status || 200; }
  for (let i = 0; i < 8; i += 1) assert.equal(await poll(`member-${i}`), 200);
  for (let i = 1; i < 180; i += 1) assert.equal(await poll('member-0'), 200);
  assert.equal(await poll('member-0'), 429);
  const { consumeRate } = await import('../server-side/store.mjs');
  const aggregateReq = { headers: {}, socket: { remoteAddress: '10.0.0.8' } };
  const { clientRateKey } = await import('../server-side/http.mjs');
  const aggregateKey = `group-state-ip:all:${clientRateKey(aggregateReq, 'group-state-ip')}`;
  for (let i = 0; i < 5820; i += 1) await consumeRate(aggregateKey);
  assert.equal(await poll('new-token-after-aggregate'), 429);
});

test('feedback retention migration supports bounded resume, dry-run, and atomic apply', () => {
  const source = (args) => `
    const writes=[]; const logs=[]; let scans=0; console.log=(...items)=>logs.push(items.join(' '));
    globalThis.fetch=async (_url, options) => { const command=JSON.parse(options.body)[0]; if(command[0]==='SCAN'){ scans++; return new Response(JSON.stringify([{result: [scans===1?'next':'0', scans===1?['prefix:key']:[]]}]),{status:200}); } if(command[0]==='TTL') return new Response(JSON.stringify([{result:-1}]),{status:200}); if(command[0]==='ZCOUNT'||command[0]==='ZCARD') return new Response(JSON.stringify([{result:0}]),{status:200}); writes.push(command); return new Response(JSON.stringify([{result:1}]),{status:200}); };
    process.argv.push(...${JSON.stringify(args)}); process.env.UPSTASH_REDIS_REST_URL='https://fake.invalid'; process.env.UPSTASH_REDIS_REST_TOKEN='opaque-token'; process.env.ANALYTICS_NAMESPACE='test'; await import('./scripts/migrate-feedback-retention.mjs'); process.stdout.write(JSON.stringify({writes,logs}));
  `;
  const dry = child(source(['--max-batches=1'])); assert.deepEqual(dry.writes, []); const drySummary = JSON.parse(dry.logs[0]); assert.equal(drySummary.truncated, true); assert.equal(drySummary.nextCursor, 'next');
  const applied = child(source(['--max-batches=1', '--apply'])); assert.ok(applied.writes.some((command) => command[0] === 'EVAL' && String(command[1]).includes('EXPIRE')));
  assert.ok(!JSON.stringify(applied).includes('opaque-token'));
});
