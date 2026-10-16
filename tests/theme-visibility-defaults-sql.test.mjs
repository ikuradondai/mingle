import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.waitReady;
const owner = '11111111-1111-1111-1111-111111111111';
const fresh = '22222222-2222-2222-2222-222222222222';
const later = '33333333-3333-3333-3333-333333333333';
const configured = '44444444-4444-4444-4444-444444444444';
const first = await readFile(new URL('../supabase/migrations/202610200001_theme_visibility.sql', import.meta.url), 'utf8');
const second = await readFile(new URL('../supabase/migrations/202610210001_theme_visibility_defaults.sql', import.meta.url), 'utf8');

await db.exec(`
  create schema auth;
  create table auth.users(id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon;
  create role authenticated;
  insert into auth.users values ('${owner}'), ('${fresh}'), ('${later}'), ('${configured}');
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
await db.exec(first);
await db.exec(`
  set role postgres;
  insert into public.account_profiles(user_id, hidden_theme_ids, adult_confirmed_at, adult_confirmation_source)
    values ('${owner}', '[]'::jsonb, '2026-01-01T00:00:00Z', 'settings');
  insert into public.account_profiles(user_id, hidden_theme_ids)
    values ('${configured}', '["friends"]'::jsonb);
  set role authenticated;
`);
await db.exec(`set role postgres;`);
await db.exec(second);

let row = (await db.query(`select hidden_theme_ids, theme_visibility_initialized, adult_confirmation_source from public.account_profiles where user_id = '${owner}'`)).rows[0];
assert.deepEqual(row.hidden_theme_ids, []);
assert.equal(row.theme_visibility_initialized, true);
assert.equal(row.adult_confirmation_source, 'settings');
row = (await db.query(`select hidden_theme_ids, theme_visibility_initialized from public.account_profiles where user_id = '${configured}'`)).rows[0];
assert.deepEqual(row.hidden_theme_ids, ['friends']);
assert.equal(row.theme_visibility_initialized, true);

await db.exec(`
  set role postgres;
  insert into public.account_profiles(user_id, hidden_theme_ids)
    values ('${later}', '[]'::jsonb);
`);
row = (await db.query(`select theme_visibility_initialized from public.account_profiles where user_id = '${later}'`)).rows[0];
assert.equal(row.theme_visibility_initialized, false);
await db.exec(second);
row = (await db.query(`select theme_visibility_initialized from public.account_profiles where user_id = '${owner}'`)).rows[0];
assert.equal(row.theme_visibility_initialized, true);
row = (await db.query(`select theme_visibility_initialized from public.account_profiles where user_id = '${later}'`)).rows[0];
assert.equal(row.theme_visibility_initialized, false);

await db.exec(`set role authenticated; set request.jwt.claim.sub = '${fresh}';`);
const save = (ids) => db.query('select public.set_theme_visibility($1::text[]) as value', [ids]);
let result = await save(['intimacy']);
assert.deepEqual(result.rows[0].value, ['intimacy']);
row = (await db.query(`select hidden_theme_ids, theme_visibility_initialized from public.account_profiles where user_id = '${fresh}'`)).rows[0];
assert.deepEqual(row.hidden_theme_ids, ['intimacy']);
assert.equal(row.theme_visibility_initialized, true);
result = await save([]);
assert.deepEqual(result.rows[0].value, []);
row = (await db.query(`select hidden_theme_ids, theme_visibility_initialized from public.account_profiles where user_id = '${fresh}'`)).rows[0];
assert.deepEqual(row.hidden_theme_ids, []);
assert.equal(row.theme_visibility_initialized, true);

await db.close();
