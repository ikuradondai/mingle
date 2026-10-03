import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
const migration = await readFile(new URL('../../supabase/migrations/202610020001_accounts.sql', import.meta.url), 'utf8');
await db.exec(`create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon;
create role authenticated;
grant usage on schema public, auth to anon, authenticated;
insert into auth.users values ('00000000-0000-0000-0000-000000000001', 'a@example.test'), ('00000000-0000-0000-0000-000000000002', 'b@example.test');`);
await db.exec(migration);
await db.exec('grant select, insert, update, delete on public.favorites, public.my_sets to authenticated, anon;');
await db.exec(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.favorites(user_id, card_id) values (auth.uid(), 'date-01');
insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'A set', array['date-01','date-02','date-03','date-04','date-05','date-06']);`);
const own = await db.query('select count(*)::int as count from public.favorites');
await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; update public.my_sets set name = 'A renamed' where user_id = auth.uid();");
const ownUpdate = await db.query('select name from public.my_sets where user_id = auth.uid()');
assert.equal(ownUpdate.rows[0].name, 'A renamed');
await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';");
const cross = await db.query('select count(*)::int as count from public.favorites');
let crossInsert = false; try { await db.exec("insert into public.favorites(user_id, card_id) values ('00000000-0000-0000-0000-000000000001', 'date-02')"); crossInsert = true; } catch {}
const crossSet = await db.query('select count(*)::int as count from public.my_sets');
let crossUpdate = false; try { await db.exec("update public.my_sets set name = 'hacked' where user_id = '00000000-0000-0000-0000-000000000001'"); crossUpdate = true; } catch {}
let crossDelete = false; try { await db.exec("delete from public.my_sets where user_id = '00000000-0000-0000-0000-000000000001'"); crossDelete = true; } catch {}
let transfer = false; try { await db.exec("update public.my_sets set user_id = '00000000-0000-0000-0000-000000000002' where user_id = '00000000-0000-0000-0000-000000000001'"); transfer = true; } catch {}
let duplicate = false; try { await db.exec("insert into public.favorites(user_id, card_id) values ('00000000-0000-0000-0000-000000000002', 'date-01'), ('00000000-0000-0000-0000-000000000002', 'date-01')"); duplicate = true; } catch {}
let badCards = false; try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'bad', array['date-01','date-01','date-02','date-03','date-04','date-05'])"); badCards = true; } catch {}
await db.exec('reset role; set role anon;');
await db.exec("set request.jwt.claim.sub = '';");
const anonFavorites = await db.query('select count(*)::int as count from public.favorites');
const anonSets = await db.query('select count(*)::int as count from public.my_sets');
let anonFavoriteWrite = false; let anonSetWrite = false;
try { await db.exec("insert into public.favorites(user_id, card_id) values ('00000000-0000-0000-0000-000000000001', 'date-03')"); anonFavoriteWrite = true; } catch {}
try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values ('00000000-0000-0000-0000-000000000001', 'anon', array['date-01','date-02','date-03','date-04','date-05','date-06'])"); anonSetWrite = true; } catch {}
await db.exec("reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'");
const ownerSet = await db.query('select name, user_id from public.my_sets');
let ownerTransfer = false; try { await db.exec("update public.my_sets set user_id = '00000000-0000-0000-0000-000000000002' where user_id = '00000000-0000-0000-0000-000000000001'"); ownerTransfer = true; } catch {}
let emptyName = false; let fiveCards = false; let fortyOneCards = false;
try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), '', array['date-01','date-02','date-03','date-04','date-05','date-06'])"); emptyName = true; } catch {}
try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'five', array['date-01','date-02','date-03','date-04','date-05'])"); fiveCards = true; } catch {}
try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'forty-one', array_fill('date-01'::text, ARRAY[41]))"); fortyOneCards = true; } catch {}
console.log({ own: own.rows[0].count, cross: cross.rows[0].count, crossSet: crossSet.rows[0].count, crossInsert, crossUpdate, crossDelete, transfer, ownerTransfer, duplicate, badCards, anonFavorites: anonFavorites.rows[0].count, anonSets: anonSets.rows[0].count, owner: ownerSet.rows[0] });
assert.equal(own.rows[0].count, 1); assert.equal(cross.rows[0].count, 0); assert.equal(crossSet.rows[0].count, 0); assert.equal(crossInsert, false); assert.equal(ownerTransfer, false); assert.equal(duplicate, false); assert.equal(badCards, false); assert.equal(anonFavoriteWrite, false); assert.equal(anonSetWrite, false); assert.equal(emptyName, false); assert.equal(fiveCards, false); assert.equal(fortyOneCards, false); assert.equal(anonFavorites.rows[0].count, 0); assert.equal(anonSets.rows[0].count, 0); assert.equal(ownerSet.rows[0].name, 'A renamed'); assert.equal(ownerSet.rows[0].user_id, '00000000-0000-0000-0000-000000000001');
await db.exec("reset role; delete from auth.users where id = '00000000-0000-0000-0000-000000000001'");
const cascade = await db.query("select count(*)::int as count from public.favorites where user_id = '00000000-0000-0000-0000-000000000001'");
const cascadeSets = await db.query("select count(*)::int as count from public.my_sets where user_id = '00000000-0000-0000-0000-000000000001'");
if (cascade.rows[0].count !== 0 || cascadeSets.rows[0].count !== 0) throw new Error('cascade assertion failed');
console.log(JSON.stringify({ own: own.rows[0].count, cross: cross.rows[0].count, crossSet: crossSet.rows[0].count, crossInsert, crossUpdate, crossDelete, transfer, duplicate, badCards, anonFavorites: anonFavorites.rows[0].count, anonSets: anonSets.rows[0].count, cascade: cascade.rows[0].count, cascadeSets: cascadeSets.rows[0].count }));
console.log('RLS_ASSERTIONS_OK');
await db.close();
