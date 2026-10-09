import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Local-only RLS/RPC smoke test. It never contacts Supabase.
const db = new PGlite();
await db.waitReady;
const owner = '00000000-0000-4000-8000-000000000021';
const member = '00000000-0000-4000-8000-000000000022';
const other = '00000000-0000-4000-8000-000000000023';
await db.exec(`create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public,auth to anon,authenticated,service_role;
grant all on auth.users to service_role;
insert into auth.users values ('${owner}','owner@example.test',now(),'{}'),('${member}','member@example.test',now(),'{}'),('${other}','other@example.test',now(),'{}');`);
await db.exec(await readFile(new URL('../../supabase/migrations/202610140001_organizations.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/202610190002_business_card_market.sql', import.meta.url), 'utf8'));

async function service(sql, params = []) { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } }
async function denied(role, sql) { await db.exec(`set role ${role}`); let error; try { await db.exec(sql); } catch (e) { error = e; } await db.exec('reset role'); assert.equal(error?.code, '42501'); }
for (const role of ['anon', 'authenticated']) {
  await denied(role, `select public.org_card_market_list('${member}','00000000-0000-0000-0000-000000000001',false)`);
  await denied(role, `select public.org_card_market_save('${owner}','00000000-0000-0000-0000-000000000001',null,'x','', 'group','all','{}','draft','[{"text":"x"}]'::jsonb)`);
  await denied(role, `select public.org_card_market_save_v2('${owner}','00000000-0000-0000-0000-000000000001',null,'x','', 'group',2,6,'all','{}','draft','[{"text":"x"}]'::jsonb)`);
}
for (const fn of [
  'org_card_market_entitlement(uuid,uuid)', 'org_card_market_list(uuid,uuid,boolean)',
  'org_card_market_save(uuid,uuid,uuid,text,text,text,text,text[],text,jsonb)',
  'org_card_market_save_v2(uuid,uuid,uuid,text,text,text,integer,integer,text,text[],text,jsonb)',
  'org_card_market_detail(uuid,uuid,uuid)', 'org_card_market_context(uuid,uuid)',
  'org_card_market_stop(uuid,uuid,uuid)', 'org_card_market_duplicate(uuid,uuid,uuid,text,text,text,text[])',
  'org_card_market_play(uuid,uuid,uuid,text,integer)',
]) {
  assert.equal((await service(`select has_function_privilege('service_role','public.${fn}','execute') as ok`)).rows[0].ok, true, fn);
  for (const role of ['anon', 'authenticated']) assert.equal((await service(`select has_function_privilege('${role}','public.${fn}','execute') as ok`)).rows[0].ok, false, role);
}
const org = (await service("select (public.org_create($1,'market-org','Market Org')).id", [owner])).rows[0].id;
const otherOrg = (await service("select (public.org_create($1,'other-market-org','Other Market Org')).id", [other])).rows[0].id;
await service("insert into public.organization_members(organization_id,user_id,email_normalized,display_name,department,status,role,claimed_at) values ($1,$2,'member@example.test','Member','sales','active','member',now()),($1,$3,'other@example.test','Other','engineering','active','member',now())", [org, member, other]);
await assert.rejects(() => service('select public.org_card_market_list($1,$2,false)', [owner, otherOrg]), /ORG_FORBIDDEN/);
await assert.rejects(() => service("select public.org_card_market_save($1,$2,null,'cross-org','', 'group','all','{}','draft','[{\"text\":\"x\"}]'::jsonb)", [owner, otherOrg]), /ORG_FORBIDDEN/);
await assert.rejects(() => service("select public.org_card_market_save($1,$2,null,'no-entitlement','', 'group','all','{}','draft','[{\"text\":\"x\"}]'::jsonb)", [other, otherOrg]), /ENTITLEMENT_REQUIRED/);
await service("insert into public.organization_card_market_entitlements(organization_id,active_until,granted_by) values ($1,now()+interval '1 hour',$2)", [org, owner]);
const cards = JSON.stringify([{ text: '社内で使う質問' }, { text: 'もう一枚の質問' }]);
const published = (await service("select public.org_card_market_save_v2($1,$2,null,'営業向け','説明','group',2,6,'departments',array['sales'],'published',$3::jsonb) as value", [owner, org, cards])).rows[0].value;
assert.equal(published.status, 'published');
assert.equal(published.minParticipants, 2);
assert.equal(published.maxParticipants, 6);
const normalized = (await service("select public.org_card_market_save_v2($1,$2,null,'trimmed','', 'group',2,6,'all','{}','draft','[{\"text\":\" x \"}]'::jsonb) as value", [owner, org])).rows[0].value;
const normalizedCard = (await service('select cards->0->>\'text\' as text from public.organization_card_market_versions where set_id=$1 and version=$2', [normalized.id, normalized.version])).rows[0].text;
assert.equal(normalizedCard, 'x');
await assert.rejects(() => service("select public.org_card_market_save($1,$2,null,'bad-shape','', 'group','all','{}','draft','[{\"text\":\"x\",\"secret\":true}]'::jsonb)", [owner, org]), /CARD_MARKET_INVALID/);
await assert.rejects(() => service("select public.org_card_market_save_v2($1,$2,null,'bad-min','', 'group',1,8,'all','{}','draft',$3::jsonb)", [owner, org, cards]), /CARD_MARKET_INVALID/);
await assert.rejects(() => service("select public.org_card_market_save_v2($1,$2,null,'bad-solo','', 'solo',2,2,'all','{}','draft',$3::jsonb)", [owner, org, cards]), /CARD_MARKET_INVALID/);
await assert.rejects(() => service("select public.org_card_market_save_v2($1,$2,null,'null-min','', 'group',null,6,'all','{}','draft',$3::jsonb)", [owner, org, cards]), /CARD_MARKET_INVALID/);
const visible = (await service('select public.org_card_market_list($1,$2,false) as value', [member, org])).rows[0].value;
assert.equal(visible.length, 1);
const hidden = (await service('select public.org_card_market_list($1,$2,false) as value', [other, org])).rows[0].value;
assert.equal(hidden.length, 0);
await service("update public.organization_members set department=null where organization_id=$1 and user_id=$2", [org, other]);
await assert.rejects(() => service('select public.org_card_market_play($1,$2,$3,$4,$5)', [other, org, published.id, 'group', 2]), /CARD_MARKET_NOT_FOUND/);
await service("update public.organization_members set department='engineering' where organization_id=$1 and user_id=$2", [org, other]);
await assert.rejects(() => service('select public.org_card_market_play($1,$2,$3,$4,$5)', [member, org, published.id, null, 2]), /PARTICIPANT_COUNT_INVALID/);
await assert.rejects(() => service('select public.org_card_market_play($1,$2,$3,$4,$5)', [member, org, published.id, 'group', 7]), /PARTICIPANT_COUNT_INVALID/);
await service("update public.organization_members set department='engineering' where organization_id=$1 and user_id=$2", [org, member]);
assert.equal((await service('select public.org_card_market_list($1,$2,false) as value', [member, org])).rows[0].value.length, 0);
await service("update public.organization_members set department='sales' where organization_id=$1 and user_id=$2", [org, member]);
await service("update public.organization_members set status='suspended' where organization_id=$1 and user_id=$2", [org, member]);
await assert.rejects(() => service('select public.org_card_market_list($1,$2,false)', [member, org]), /ORG_FORBIDDEN/);
await service("update public.organization_members set status='active' where organization_id=$1 and user_id=$2", [org, member]);
await assert.rejects(() => service('select public.org_card_market_save($1,$2,null,$3,$4,$5,$6,$7,$8,$9::jsonb)', [member, org, 'x', '', 'group', 'all', [], 'draft', cards]), /ORG_FORBIDDEN/);
const played = (await service('select public.org_card_market_play($1,$2,$3,$4,$5) as value', [member, org, published.id, 'group', 2])).rows[0].value;
assert.equal(played.cards.length, 2);
await assert.rejects(() => service('select public.org_card_market_detail($1,$2,$3)', [member, org, published.id]), /ORG_FORBIDDEN/);
const detail = (await service('select public.org_card_market_detail($1,$2,$3) as value', [owner, org, published.id])).rows[0].value;
assert.equal(detail.cards.length, 2);
await assert.rejects(() => service('select public.org_card_market_list($1,$2,true)', [member, org]), /ORG_FORBIDDEN/);
await assert.rejects(() => service('select public.org_card_market_play($1,$2,$3,$4,$5)', [other, org, published.id, 'group', 2]), /CARD_MARKET_NOT_FOUND/);
await service("update public.organization_card_market_entitlements set active_until=now()-interval '1 second' where organization_id=$1", [org]);
await assert.rejects(() => service('select public.org_card_market_play($1,$2,$3,$4,$5)', [member, org, published.id, 'group', 2]), /ENTITLEMENT_REQUIRED/);
await service("update public.organization_card_market_entitlements set active_until=now()+interval '1 hour' where organization_id=$1", [org]);
const draft = (await service("select public.org_card_market_save_v2($1,$2,$3,'営業向け改訂','説明','group',2,4,'departments',array['sales'],'draft',$4::jsonb) as value", [owner, org, published.id, cards])).rows[0].value;
assert.equal(draft.status, 'draft');
assert.equal((await service('select public.org_card_market_list($1,$2,false) as value', [member, org])).rows[0].value.length, 0);
const ownerView = (await service('select public.org_card_market_list($1,$2,true) as value', [owner, org])).rows[0].value;
assert.equal(ownerView[0].status, 'draft');
assert.equal((await service('select count(*)::int as count from public.organization_card_market_versions where set_id=$1', [published.id])).rows[0].count, 2);
await service("select public.org_card_market_stop($1,$2,$3)", [owner, org, published.id]);
assert.equal((await service('select status from public.organization_card_market_sets where id=$1', [published.id])).rows[0].status, 'stopped');
// The per-organization set cap is enforced atomically under the advisory lock.
const capOrg = (await service("select (public.org_create($1,'cap-market-org','Cap Market Org')).id", [owner])).rows[0].id;
await service("insert into public.organization_card_market_entitlements(organization_id,active_until,granted_by) values ($1,now()+interval '1 hour',$2)", [capOrg, owner]);
for (let i = 0; i < 100; i += 1) {
  await service("select public.org_card_market_save_v2($1,$2,null,$3,'','group',2,6,'all','{}','draft',$4::jsonb)", [owner, capOrg, `Cap ${i}`, '[{"text":"cap"}]']);
}
await assert.rejects(() => service("select public.org_card_market_save_v2($1,$2,null,'Cap 101','', 'group',2,6,'all','{}','draft',$3::jsonb)", [owner, capOrg, '[{"text":"cap"}]']), /CARD_MARKET_LIMIT/);
// Delete a non-owner author so the organization's creator cascade does not remove the set.
await service("update public.organization_card_market_sets set created_by=$2,updated_by=$2 where id=$1", [published.id, member]);
await service("delete from auth.users where id=$1", [member]);
const audit = (await service('select created_by,updated_by from public.organization_card_market_sets where id=$1', [published.id])).rows[0];
assert.equal(audit.created_by, null);
assert.equal(audit.updated_by, null);
await service('select public.org_delete($1,$2)', [other, otherOrg]);
assert.equal((await service('select count(*)::int as count from public.organization_card_market_sets where organization_id=$1', [otherOrg])).rows[0].count, 0);
console.log('business card market RPC permissions and tenant visibility verified on PGlite');
await db.close();
