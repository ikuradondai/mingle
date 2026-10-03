import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const root = new URL('../../../site/', import.meta.url);
const migrations = await Promise.all(['202610020001_accounts.sql', '202610030001_custom_cards.sql', '202610040001_shared_sets.sql'].map((name) => readFile(new URL(`supabase/migrations/${name}`, root), 'utf8')));
await db.exec(`create schema auth; create table auth.users (id uuid primary key, email text); create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; create role anon; create role authenticated; grant usage on schema public, auth to anon, authenticated; insert into auth.users values ('00000000-0000-0000-0000-000000000001','a@example.test'), ('00000000-0000-0000-0000-000000000002','b@example.test');`);
for (const migration of migrations) await db.exec(migration);
await db.exec('grant select, insert, update, delete on public.favorites, public.my_sets, public.custom_cards to authenticated, anon;');
await db.exec("set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; insert into public.my_sets(user_id,name,card_ids) values (auth.uid(),'share',array['date-01','date-02','date-03','date-04','date-05','date-06']);");
const setId = (await db.query('select id from public.my_sets limit 1')).rows[0].id;
const cards = JSON.stringify(['date-01', 'date-02', 'date-03', 'date-04', 'date-05', 'date-06'].map((id) => ({ id, text: id, r18: false, kind: 'question' }))).replaceAll("'", "''");
await db.exec(`select * from public.create_shared_set('${setId}','${'A'.repeat(43)}','${'a'.repeat(64)}','share',6,false,'${cards}'::jsonb,false)`);
await db.exec("set role anon; set request.jwt.claim.sub = '';");
let anonDenied = false; try { await db.query('select count(*) from public.shared_sets'); } catch { anonDenied = true; }
assert.equal(anonDenied, true);
await db.exec("reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';");
assert.equal((await db.query('select count(*)::int as count from public.shared_sets')).rows[0].count, 0);
await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';");
assert.equal((await db.query('select count(*)::int as count from public.shared_sets')).rows[0].count, 1);
await db.exec("reset role; delete from auth.users where id='00000000-0000-0000-0000-000000000001';");
assert.equal((await db.query('select count(*)::int as count from public.shared_sets')).rows[0].count, 0);
console.log('SHARE_RLS_PGLITE_ASSERTIONS_OK');
await db.close();
