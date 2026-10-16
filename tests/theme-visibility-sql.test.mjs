import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.waitReady;
const q = (sql, params) => db.query(sql, params);
const owner = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
const migration = await readFile(new URL('../supabase/migrations/202610200001_theme_visibility.sql', import.meta.url), 'utf8');

await db.exec(`
  create schema auth;
  create table auth.users(id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon;
  create role authenticated;
  insert into auth.users values ('${owner}'), ('${other}');
  create table public.account_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    adult_confirmed_at timestamptz null,
    adult_confirmation_source text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint account_profiles_adult_pair check ((adult_confirmed_at is null) = (adult_confirmation_source is null))
  );
  alter table public.account_profiles enable row level security;
  revoke all on public.account_profiles from anon, authenticated;
  grant select on public.account_profiles to authenticated;
  create policy account_profiles_owner_select on public.account_profiles
    for select to authenticated using ((select auth.uid()) = user_id);
  grant usage on schema auth, public to anon, authenticated;
`);
await db.exec(migration);

await db.exec(`
  set role postgres;
  insert into public.account_profiles(user_id, adult_confirmed_at, adult_confirmation_source)
    values ('${owner}', '2026-01-01T00:00:00Z', 'settings');
  set role authenticated;
  set request.jwt.claim.sub = '${owner}';
`);

const save = async (ids) => q('select public.set_theme_visibility($1::text[]) as value', [ids]);
const readOwn = async () => q('select hidden_theme_ids, adult_confirmed_at, adult_confirmation_source from public.account_profiles where user_id = auth.uid()');

let result = await save(['date', 'friends']);
assert.deepEqual(result.rows[0].value, ['date', 'friends']);
let row = (await readOwn()).rows[0];
assert.deepEqual(row.hidden_theme_ids, ['date', 'friends']);
assert.equal(row.adult_confirmation_source, 'settings');

result = await save([]);
assert.deepEqual(result.rows[0].value, []);
row = (await readOwn()).rows[0];
assert.deepEqual(row.hidden_theme_ids, []);
assert.equal(row.adult_confirmed_at.toISOString(), '2026-01-01T00:00:00.000Z');

for (const ids of [['date', 'date'], [null], Array.from({ length: 201 }, (_, i) => `theme-${i}`)]) {
  await assert.rejects(() => save(ids), /INVALID_REQUEST|duplicate key|constraint|null/i);
}

// The RPC contract bounds IDs to 100 characters and a lowercase slug shape.
await assert.rejects(() => save(['x'.repeat(101)]), /INVALID_REQUEST|constraint/i);
await assert.rejects(() => save(['date\ninvalid']), /INVALID_REQUEST|constraint/i);

await db.exec(`set request.jwt.claim.sub = '${other}';`);
const otherRows = await q('select hidden_theme_ids from public.account_profiles');
assert.deepEqual(otherRows.rows, []);
await assert.rejects(
  () => q("update public.account_profiles set hidden_theme_ids = '[\"hacked\"]'::jsonb where user_id = $1", [owner]),
  /permission denied|42501/i,
);
await save(['other']);
assert.deepEqual((await q('select hidden_theme_ids from public.account_profiles where user_id = auth.uid()')).rows[0].hidden_theme_ids, ['other']);

await db.exec("reset role; set role anon; set request.jwt.claim.sub = '';");
await assert.rejects(() => q('select public.set_theme_visibility($1::text[])', [['anon']]), /permission denied|42501/i);

await db.exec(`reset role; delete from auth.users where id = '${owner}';`);
assert.deepEqual((await q('select hidden_theme_ids from public.account_profiles where user_id = $1', [owner])).rows, []);

await db.close();
console.log('THEME_VISIBILITY_SQL_ASSERTIONS_OK');
