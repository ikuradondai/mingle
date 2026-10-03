import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const db = new PGlite();
const migrationPath = process.env.MINGLE_SITE_ROOT
  ? resolve(process.env.MINGLE_SITE_ROOT, 'supabase/migrations/202610050001_profile_avatars.sql')
  : new URL('../../supabase/migrations/202610050001_profile_avatars.sql', import.meta.url);
const migration = await readFile(migrationPath, 'utf8');
await db.exec(`
  create schema auth;
  create schema storage;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text not null, public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id bigint generated always as identity primary key, bucket_id text not null, name text not null, owner_id uuid);
  alter table storage.objects enable row level security;
  create role anon;
  create role authenticated;
  grant usage on schema auth, storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select, insert, update, delete on storage.buckets to anon, authenticated;
  insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
`);
await db.exec(migration);
await db.exec(`
  set role authenticated;
  set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
  insert into storage.objects(bucket_id, name, owner_id) values ('profile-avatars', '00000000-0000-0000-0000-000000000001/avatar.jpg', auth.uid());
`);
const own = await db.query("select name from storage.objects where bucket_id = 'profile-avatars'");
assert.deepEqual(own.rows.map((row) => row.name), ['00000000-0000-0000-0000-000000000001/avatar.jpg']);
const ownerUpdate = await db.query("update storage.objects set owner_id = auth.uid() where name = '00000000-0000-0000-0000-000000000001/avatar.jpg' returning id");
assert.equal(ownerUpdate.rows.length, 1);
let ownerTransfer = false; try { ownerTransfer = (await db.query("update storage.objects set name = '00000000-0000-0000-0000-000000000002/avatar.jpg' where name = '00000000-0000-0000-0000-000000000001/avatar.jpg' returning id")).rows.length > 0; } catch {}
assert.equal(ownerTransfer, false);
const ownerDelete = await db.query("delete from storage.objects where name = '00000000-0000-0000-0000-000000000001/avatar.jpg' returning id");
assert.equal(ownerDelete.rows.length, 1);
await db.exec("insert into storage.objects(bucket_id, name, owner_id) values ('profile-avatars', '00000000-0000-0000-0000-000000000001/avatar.jpg', auth.uid())");
await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'");
assert.equal((await db.query("select count(*)::int as count from storage.objects where bucket_id = 'profile-avatars'")).rows[0].count, 0);
let crossInsert = false; try { await db.exec("insert into storage.objects(bucket_id, name, owner_id) values ('profile-avatars', '00000000-0000-0000-0000-000000000001/avatar.jpg', auth.uid())"); crossInsert = true; } catch {}
let wrongPath = false; try { await db.exec("insert into storage.objects(bucket_id, name, owner_id) values ('profile-avatars', '00000000-0000-0000-0000-000000000002/other.jpg', auth.uid())"); wrongPath = true; } catch {}
let crossUpdate = false; try { crossUpdate = (await db.query("update storage.objects set name = '00000000-0000-0000-0000-000000000002/avatar.jpg' where name like '00000000-0000-0000-0000-000000000001/%' returning id")).rows.length > 0; } catch {}
let crossDelete = false; try { crossDelete = (await db.query("delete from storage.objects where name like '00000000-0000-0000-0000-000000000001/%' returning id")).rows.length > 0; } catch {}
await db.exec('reset role; set role anon; set request.jwt.claim.sub = \'\';');
const anonRows = await db.query("select count(*)::int as count from storage.objects where bucket_id = 'profile-avatars'");
let anonInsert = false; try { await db.exec("insert into storage.objects(bucket_id, name) values ('profile-avatars', 'x/avatar.jpg')"); anonInsert = true; } catch {}
assert.equal(crossInsert, false); assert.equal(wrongPath, false); assert.equal(crossUpdate, false); assert.equal(crossDelete, false); assert.equal(anonRows.rows[0].count, 0); assert.equal(anonInsert, false);
await db.exec("reset role; update storage.buckets set public = true, file_size_limit = 1, allowed_mime_types = array['image/png'] where id = 'profile-avatars'");
await db.exec(migration);
const bucket = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'profile-avatars'");
assert.deepEqual(bucket.rows[0], { public: false, file_size_limit: 262144, allowed_mime_types: ['image/jpeg'] });
console.log('AVATAR_RLS_ASSERTIONS_OK');
await db.close();
