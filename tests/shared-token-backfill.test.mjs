import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const keyText = 'backfill-test-key-012345678901234567890';
const token = 'T'.repeat(43);
const hash = createHash('sha256').update(token).digest('hex');
const key = createHash('sha256').update(`mingle shared token v1:${keyText}`).digest();
function cipher(value) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); const payload = Buffer.concat([c.update(value), c.final()]); return `${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${payload.toString('base64url')}`; }

async function run(mode, target) {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, token: null, token_ciphertext: null, token_hash: 'none' }));
  rows.push(target);
  const patches = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET') {
      const eq = url.searchParams.get('id')?.startsWith('eq.');
      const gt = url.searchParams.get('id')?.startsWith('gt.');
      const body = eq ? [target] : gt ? [target] : rows.slice(0, 200);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return;
    }
    if (req.method === 'PATCH') { let body = ''; req.on('data', (chunk) => { body += chunk; }); req.on('end', () => { const parsed = JSON.parse(body); patches.push(parsed); Object.assign(target, parsed); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify([target])); }); return; }
    res.writeHead(405); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const args = ['scripts/shared-token-backfill.mjs', ...(mode ? [`--${mode}`] : [])];
  const result = await new Promise((resolve) => { const child = spawn(process.execPath, args, { cwd: new URL('..', import.meta.url), env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', SHARED_TOKEN_ENCRYPTION_KEY: keyText } }); let out = ''; child.stdout.on('data', (x) => { out += x; }); child.on('close', (code) => resolve({ code, out })); });
  await new Promise((resolve) => server.close(resolve));
  return { result, patches };
}

test('backfill dry-run paginates without writing', async () => {
  const { result, patches } = await run('', { id: '00000000-0000-4000-8000-000000000999', token, token_ciphertext: null, token_hash: hash });
  assert.equal(result.code, 0); assert.match(result.out, /dry-run scanned=201 changed=1/); assert.equal(patches.length, 0);
});

test('backfill apply and rollback use verified atomic fields', async () => {
  const applied = await run('apply', { id: '00000000-0000-4000-8000-000000000999', token, token_ciphertext: null, token_hash: hash });
  assert.equal(applied.result.code, 0); assert.equal(applied.patches.length, 1); assert.equal(applied.patches[0].token, null); assert.equal(typeof applied.patches[0].token_ciphertext, 'string');
  const rolled = await run('rollback', { id: '00000000-0000-4000-8000-000000000999', token: null, token_ciphertext: cipher(token), token_hash: hash });
  assert.equal(rolled.result.code, 0); assert.deepEqual(rolled.patches, [{ token }]);
});
