import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const sql = await readFile(new URL('../../supabase/migrations/202610110002_sponsors.sql', import.meta.url), 'utf8');
await db.exec("create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;");
await db.exec(sql);
const cards = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(4, '0')}11111111`.slice(0, 36), text: `Q${i}` })));
const denied = async (role) => { await db.exec(`set role ${role}`); let error; try { await db.exec("select * from public.sponsor_sets"); } catch (e) { error = e; } await db.exec('reset role'); assert.equal(error?.code, '42501'); };
await denied('anon'); await denied('authenticated');
await db.exec(`set role service_role`);
await db.query("insert into public.sponsor_sets(id,provider_name,title,categories,audience,cards,created_by) values ('00000000-0000-4000-8000-000000000001','Provider','Title',array['friends'],'group',$1::jsonb,'admin')", [cards]);
const count = await db.query("select card_count from public.sponsor_sets where id='00000000-0000-4000-8000-000000000001'"); assert.equal(count.rows[0].card_count, 6);
await assert.rejects(() => db.query("insert into public.sponsor_sets(id,provider_name,title,categories,audience,cards,created_by) values ('00000000-0000-4000-8000-000000000002','P','T',array['friends'],'group','[]'::jsonb,'admin')"));
await assert.rejects(() => db.query("insert into public.sponsor_sets(id,provider_name,title,categories,audience,cards,site_url,created_by) values ('00000000-0000-4000-8000-000000000003','P','T',array['friends'],'group',$1::jsonb,'http://example.com','admin')", [cards]));
await db.query("insert into public.sponsor_sets(id,provider_name,title,categories,audience,cards,is_r18,created_by) values ('00000000-0000-4000-8000-000000000004','P','Adult',array['adult'],'group',$1::jsonb,true,'admin')", [cards]);
await assert.rejects(() => db.query("update public.sponsor_sets set is_r18=false where id='00000000-0000-4000-8000-000000000004'"));
await db.exec('reset role'); await db.close(); console.log('sponsor migration card bounds and anon denial verified on PGlite');
