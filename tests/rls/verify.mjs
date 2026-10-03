import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
const migration = `${await readFile(new URL('../../supabase/migrations/202610020001_accounts.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../../supabase/migrations/202610030001_custom_cards.sql', import.meta.url), 'utf8')}`;
await db.exec(`create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon;
create role authenticated;
grant usage on schema public, auth to anon, authenticated;
insert into auth.users values ('00000000-0000-0000-0000-000000000001', 'a@example.test'), ('00000000-0000-0000-0000-000000000002', 'b@example.test');`);
await db.exec(migration);
await db.exec('grant select, insert, update, delete on public.favorites, public.my_sets, public.custom_cards to authenticated, anon;');
await db.exec(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.favorites(user_id, card_id) values (auth.uid(), 'date-01');
insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'A set', array['date-01','date-02','date-03','date-04','date-05','date-06']);`);
const customId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
await db.exec(`insert into public.custom_cards(id, user_id, text, r18) values ('${customId}', auth.uid(), 'Private question', false);
update public.my_sets set card_ids = array['date-01','date-02','date-03','date-04','date-05','custom:${customId}'] where user_id = auth.uid();`);
const own = await db.query('select count(*)::int as count from public.favorites');
await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; update public.my_sets set name = 'A renamed' where user_id = auth.uid();");
const ownUpdate = await db.query('select name from public.my_sets where user_id = auth.uid()');
assert.equal(ownUpdate.rows[0].name, 'A renamed');
await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';");
const cross = await db.query('select count(*)::int as count from public.favorites');
let crossInsert = false; try { await db.exec("insert into public.favorites(user_id, card_id) values ('00000000-0000-0000-0000-000000000001', 'date-02')"); crossInsert = true; } catch {}
const crossSet = await db.query('select count(*)::int as count from public.my_sets');
const crossCards = await db.query('select count(*)::int as count from public.custom_cards');
let crossUpdate = false; try { crossUpdate = (await db.query("update public.my_sets set name = 'hacked' where user_id = '00000000-0000-0000-0000-000000000001' returning id")).rows.length > 0; } catch {}
let crossDelete = false; try { crossDelete = (await db.query("delete from public.my_sets where user_id = '00000000-0000-0000-0000-000000000001' returning id")).rows.length > 0; } catch {}
let transfer = false; try { transfer = (await db.query("update public.my_sets set user_id = '00000000-0000-0000-0000-000000000002' where user_id = '00000000-0000-0000-0000-000000000001' returning id")).rows.length > 0; } catch {}
let crossCardInsert = false; try { await db.exec(`insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'foreign', array['date-01','date-02','date-03','date-04','date-05','custom:${customId}'])`); crossCardInsert = true; } catch {}
let crossCardUpdate = false; try { crossCardUpdate = (await db.query(`update public.custom_cards set text = 'hacked' where id = '${customId}' returning id`)).rows.length > 0; } catch {}
let crossCardDelete = false; try { crossCardDelete = (await db.query(`delete from public.custom_cards where id = '${customId}' returning id`)).rows.length > 0; } catch {}
let crossCardTransfer = false; try { crossCardTransfer = (await db.query(`update public.custom_cards set user_id = '00000000-0000-0000-0000-000000000002' where id = '${customId}' returning id`)).rows.length > 0; } catch {}
let duplicate = false; try { await db.exec("insert into public.favorites(user_id, card_id) values ('00000000-0000-0000-0000-000000000002', 'date-01'), ('00000000-0000-0000-0000-000000000002', 'date-01')"); duplicate = true; } catch {}
let badCards = false; try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'bad', array['date-01','date-01','date-02','date-03','date-04','date-05'])"); badCards = true; } catch {}
await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'");
let ownerCardTransfer = false; try { ownerCardTransfer = (await db.query(`update public.custom_cards set user_id = '00000000-0000-0000-0000-000000000002' where id = '${customId}' returning id`)).rows.length > 0; } catch {}
let ownerCardIdChange = false; try { ownerCardIdChange = (await db.query(`update public.custom_cards set id = '20000000-0000-4000-8000-000000000002' where id = '${customId}' returning id`)).rows.length > 0; } catch {}
let uppercaseRef = false; try { await db.exec(`insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'uppercase', array['date-01','date-02','date-03','date-04','date-05','custom:${customId.toUpperCase()}'])`); uppercaseRef = true; } catch {}
let usedCardDelete = false; try { await db.exec(`delete from public.custom_cards where id = '${customId}'`); usedCardDelete = true; } catch {}
let blankCustom = false; try { await db.exec("insert into public.custom_cards(user_id, text, r18) values (auth.uid(), '   ', false)"); blankCustom = true; } catch {}
let longCustom = false; try { await db.exec(`insert into public.custom_cards(user_id, text, r18) values (auth.uid(), '${'x'.repeat(301)}', false)`); longCustom = true; } catch {}
let newlineCustom = false; try { await db.exec("insert into public.custom_cards(user_id, text, r18) values (auth.uid(), E'line\\nfeed', false)"); newlineCustom = true; } catch {}
let nullR18 = false; try { await db.exec("insert into public.custom_cards(user_id, text, r18) values (auth.uid(), 'missing flag', null)"); nullR18 = true; } catch {}
await db.exec('reset role; set role anon;');
await db.exec("set request.jwt.claim.sub = '';");
const anonFavorites = await db.query('select count(*)::int as count from public.favorites');
const anonSets = await db.query('select count(*)::int as count from public.my_sets');
let anonFavoriteWrite = false; let anonSetWrite = false;
try { await db.exec("insert into public.favorites(user_id, card_id) values ('00000000-0000-0000-0000-000000000001', 'date-03')"); anonFavoriteWrite = true; } catch {}
try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values ('00000000-0000-0000-0000-000000000001', 'anon', array['date-01','date-02','date-03','date-04','date-05','date-06'])"); anonSetWrite = true; } catch {}
const anonCards = await db.query('select count(*)::int as count from public.custom_cards');
await db.exec("reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'");
const ownerSet = await db.query('select name, user_id from public.my_sets');
let ownerTransfer = false; try { ownerTransfer = (await db.query("update public.my_sets set user_id = '00000000-0000-0000-0000-000000000002' where user_id = '00000000-0000-0000-0000-000000000001' returning id")).rows.length > 0; } catch {}
let emptyName = false; let fiveCards = false; let fortyOneCards = false;
try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), '', array['date-01','date-02','date-03','date-04','date-05','date-06'])"); emptyName = true; } catch {}
try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'five', array['date-01','date-02','date-03','date-04','date-05'])"); fiveCards = true; } catch {}
try { await db.exec("insert into public.my_sets(user_id, name, card_ids) values (auth.uid(), 'forty-one', array_fill('date-01'::text, ARRAY[41]))"); fortyOneCards = true; } catch {}
console.log({ own: own.rows[0].count, cross: cross.rows[0].count, crossSet: crossSet.rows[0].count, crossCards: crossCards.rows[0].count, crossInsert, crossCardInsert, crossCardUpdate, crossCardDelete, crossCardTransfer, ownerCardTransfer, ownerCardIdChange, uppercaseRef, usedCardDelete, blankCustom, longCustom, newlineCustom, nullR18, crossUpdate, crossDelete, transfer, ownerTransfer, duplicate, badCards, anonFavorites: anonFavorites.rows[0].count, anonSets: anonSets.rows[0].count, anonCards: anonCards.rows[0].count, owner: ownerSet.rows[0] });
assert.equal(own.rows[0].count, 1); assert.equal(cross.rows[0].count, 0); assert.equal(crossSet.rows[0].count, 0); assert.equal(crossCards.rows[0].count, 0); assert.equal(crossInsert, false); assert.equal(crossCardInsert, false); assert.equal(crossCardUpdate, false); assert.equal(crossCardDelete, false); assert.equal(crossCardTransfer, false); assert.equal(ownerCardTransfer, false); assert.equal(ownerCardIdChange, false); assert.equal(uppercaseRef, false); assert.equal(usedCardDelete, false); assert.equal(blankCustom, false); assert.equal(longCustom, false); assert.equal(newlineCustom, false); assert.equal(nullR18, false); assert.equal(ownerTransfer, false); assert.equal(duplicate, false); assert.equal(badCards, false); assert.equal(anonFavoriteWrite, false); assert.equal(anonSetWrite, false); assert.equal(emptyName, false); assert.equal(fiveCards, false); assert.equal(fortyOneCards, false); assert.equal(anonFavorites.rows[0].count, 0); assert.equal(anonSets.rows[0].count, 0); assert.equal(anonCards.rows[0].count, 0); assert.equal(ownerSet.rows[0].name, 'A renamed'); assert.equal(ownerSet.rows[0].user_id, '00000000-0000-0000-0000-000000000001');
await db.exec("reset role; delete from auth.users where id = '00000000-0000-0000-0000-000000000001'");
const cascade = await db.query("select count(*)::int as count from public.favorites where user_id = '00000000-0000-0000-0000-000000000001'");
const cascadeSets = await db.query("select count(*)::int as count from public.my_sets where user_id = '00000000-0000-0000-0000-000000000001'");
const cascadeCards = await db.query("select count(*)::int as count from public.custom_cards where user_id = '00000000-0000-0000-0000-000000000001'");
if (cascade.rows[0].count !== 0 || cascadeSets.rows[0].count !== 0 || cascadeCards.rows[0].count !== 0) throw new Error('cascade assertion failed');
console.log(JSON.stringify({ own: own.rows[0].count, cross: cross.rows[0].count, crossSet: crossSet.rows[0].count, crossInsert, crossUpdate, crossDelete, transfer, duplicate, badCards, anonFavorites: anonFavorites.rows[0].count, anonSets: anonSets.rows[0].count, cascade: cascade.rows[0].count, cascadeSets: cascadeSets.rows[0].count, cascadeCards: cascadeCards.rows[0].count }));
console.log('RLS_ASSERTIONS_OK');
await db.close();
