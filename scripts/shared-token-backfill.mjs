#!/usr/bin/env node
/* Dry-run by default. --apply encrypts and atomically clears legacy token.
 * --rollback explicitly restores plaintext from ciphertext for recovery only. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const encryptionKey = process.env.SHARED_TOKEN_ENCRYPTION_KEY || '';
if (!base || !serviceKey || encryptionKey.length < 32) throw new Error('missing migration configuration');
const key = createHash('sha256').update(`mingle shared token v1:${encryptionKey}`).digest();
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json', 'Content-Type': 'application/json' };
async function api(path, options = {}) { const response = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } }); let body = null; try { body = await response.json(); } catch {} if (!response.ok) throw new Error(`migration request failed (${response.status})`); return body; }
function encrypt(token) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const payload = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${payload.toString('base64url')}`; }
function decrypt(value) { const [iv, tag, payload] = String(value).split('.').map((part) => Buffer.from(part, 'base64url')); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8'); }
function valid(token) { return /^[A-Za-z0-9_-]{43}$/.test(token); }
const rollback = process.argv.includes('--rollback');
const apply = process.argv.includes('--apply') || rollback;
let cursor = '';
let changed = 0;
let scanned = 0;
for (;;) {
  const filter = cursor ? `&id=gt.${encodeURIComponent(cursor)}` : '';
  const rows = await api(`/rest/v1/shared_sets?select=id,token,token_ciphertext,token_hash&order=id.asc&limit=200${filter}`);
  if (!Array.isArray(rows) || rows.length === 0) break;
  for (const row of rows) {
    scanned++;
    cursor = row.id;
    if (rollback) {
      if (!row.token_ciphertext || row.token) continue;
      const token = decrypt(row.token_ciphertext);
      if (!valid(token) || createHash('sha256').update(token).digest('hex') !== row.token_hash) throw new Error('ciphertext verification failed');
      if (apply) await api(`/rest/v1/shared_sets?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ token }) });
      changed++;
      continue;
    }
    if (!row.token) continue;
    if (row.token_ciphertext) {
      const existing = decrypt(row.token_ciphertext);
      if (existing !== row.token || createHash('sha256').update(existing).digest('hex') !== row.token_hash) throw new Error('incomplete backfill verification failed');
      if (apply) await api(`/rest/v1/shared_sets?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ token: null }) });
      changed++;
      continue;
    }
    if (!valid(row.token) || createHash('sha256').update(row.token).digest('hex') !== row.token_hash) throw new Error('legacy token verification failed');
    const ciphertext = encrypt(row.token);
    if (decrypt(ciphertext) !== row.token) throw new Error('encryption verification failed');
    if (apply) {
      await api(`/rest/v1/shared_sets?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ token_ciphertext: ciphertext, token: null }) });
      const verify = (await api(`/rest/v1/shared_sets?id=eq.${encodeURIComponent(row.id)}&select=id,token,token_ciphertext,token_hash`))?.[0];
      if (!verify || verify.token !== null || decrypt(verify.token_ciphertext) !== row.token || verify.token_hash !== row.token_hash) throw new Error('backfill verification failed');
    }
    changed++;
  }
  if (rows.length < 200) break;
}
console.log(`${rollback ? 'rollback' : apply ? 'backfill' : 'dry-run'} scanned=${scanned} changed=${changed}`);
