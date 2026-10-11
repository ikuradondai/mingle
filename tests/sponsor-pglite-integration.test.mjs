import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createSponsorService } from '../server-side/sponsors.mjs';

const env = { SUPABASE_URL: 'https://pglite.test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
const cards = Array.from({ length: 6 }, (_, i) => ({ text: `質問${i}` }));
const uuid = '11111111-1111-4111-8111-111111111111';
function response(value, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return value; } }; }

test('service CRUD contract works against the sponsor migration in PGlite', async () => {
  const db = new PGlite();
  const migration = await readFile(new URL('../supabase/migrations/202610110002_sponsors.sql', import.meta.url), 'utf8');
  const assetsMigration = await readFile(new URL('../supabase/migrations/202610110003_sponsor_assets.sql', import.meta.url), 'utf8');
  await db.exec("create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(bucket_id text,name text);"); await db.exec(migration); await db.exec(assetsMigration);
  const query = async (sql, params = []) => { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url); const payload = options.body ? JSON.parse(options.body) : null; const id = parsed.searchParams.get('id')?.replace(/^eq\./, '');
    if (options.method === 'POST') {
      const result = await query('insert into public.sponsor_sets(id,provider_name,title,description,categories,audience,cards,status,end_message,site_url,cta_label,is_r18,created_by,updated_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14) returning *', [payload.id, payload.provider_name, payload.title, payload.description, payload.categories, payload.audience, JSON.stringify(payload.cards), payload.status, payload.end_message, payload.site_url, payload.cta_label, payload.is_r18, payload.created_by, payload.updated_at]); return response(result.rows);
    }
    if (options.method === 'PATCH') {
      const keys = Object.keys(payload); const values = keys.map((key) => payload[key]); const assigns = keys.map((key, i) => `${key}=$${i + 1}`).join(','); const result = await query(`update public.sponsor_sets set ${assigns} where id=$${keys.length + 1} returning *`, [...values, id]); return response(result.rows);
    }
    const clauses = []; const params = []; if (id) { clauses.push(`id=$${params.length + 1}`); params.push(id); } if (parsed.searchParams.get('status') === 'eq.published') clauses.push(`status='published'`); const result = await query(`select * from public.sponsor_sets${clauses.length ? ` where ${clauses.join(' and ')}` : ''} order by updated_at desc`, params); return response(result.rows);
  };
  const service = createSponsorService({ env, fetchImpl });
  const created = await service.create({ providerName: '提供元', title: '結合テスト', categories: ['friends'], audience: 'group', cards, status: 'published', endMessage: 'ありがとう', siteUrl: 'https://example.com/#sponsor', ctaLabel: '見る' });
  assert.equal(created.cardCount, 6); const listed = await service.list(); assert.equal(listed.length, 1); assert.equal(listed[0].title, '結合テスト');
  const detail = await service.list({ id: created.id }); assert.equal(detail[0].cards.length, 6); await service.update(created.id, { status: 'draft' }); assert.deepEqual(await service.list(), []); await db.close();
});
