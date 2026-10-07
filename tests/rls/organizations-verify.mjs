import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = await readFile(new URL('../../supabase/migrations/202610140001_organizations.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001';
const member = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const claimant = '00000000-0000-4000-8000-000000000004';
const intruder = '00000000-0000-4000-8000-000000000005';
await db.exec(`create schema auth;
create table auth.users(id uuid primary key,email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
create role anon; create role authenticated; create role service_role;
alter role service_role bypassrls;
grant usage on schema public,auth to anon,authenticated,service_role;
grant all on auth.users to service_role;
insert into auth.users values ('${owner}','owner@example.test',now(),'{}'),('${member}','member@example.test',now(),'{}'),('${outsider}','outsider@example.test',now(),'{}'),('${claimant}','claimable@example.test',now(),'{}'),('${intruder}','intruder@example.test',now(),'{}');`);
await db.exec(migration);
await db.exec(migration);
async function scalar(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function service(sql, params = []) { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } }
async function denied(role, sql) { await db.exec(`set role ${role}`); let error; try { await db.exec(sql); } catch (e) { error = e; } await db.exec('reset role'); assert.equal(error?.code, '42501'); }

for (const role of ['anon', 'authenticated']) {
  await denied(role, `select public.org_create('${owner}','x-org','x')`);
  await denied(role, `select public.org_list('${owner}')`);
  await denied(role, `select public.org_workspace('${owner}','00000000-0000-0000-0000-000000000001')`);
  for (const table of ['organizations', 'organization_members', 'organization_policies']) {
    const key = table === 'organization_policies' ? 'organization_id' : 'id';
    for (const operation of [`select * from public.${table}`, `insert into public.${table} default values`, `update public.${table} set ${key}=${key}`, `delete from public.${table}`]) await denied(role, operation);
  }
}
assert.equal((await scalar("select has_function_privilege('service_role','public.org_list(uuid)','execute') AS ok")).ok, true);
assert.equal((await scalar("select has_function_privilege('anon','public.org_list(uuid)','execute') AS ok")).ok, false);
for (const fn of ['org_create(uuid,text,text)','org_list(uuid)','org_workspace(uuid,uuid)','org_import_members(uuid,uuid,jsonb)','org_set_member(uuid,uuid,uuid,text,text)','org_remove_member(uuid,uuid,uuid)','org_delete(uuid,uuid)','org_set_policy(uuid,uuid,jsonb,jsonb)','org_claim_members(uuid)']) {
  assert.equal((await scalar(`select has_function_privilege('service_role','public.${fn}','execute') AS ok`)).ok, true);
  for (const role of ['anon', 'authenticated']) assert.equal((await scalar(`select has_function_privilege('${role}','public.${fn}','execute') AS ok`)).ok, false);
}

const created = (await service("select * from public.org_create($1,'acme-one','Acme One')", [owner])).rows[0];
const org = created.id;
await service("select public.org_create($1,'acme-two','Acme Two')", [owner]);
await service("select public.org_create($1,'acme-three','Acme Three')", [owner]);
await assert.rejects(() => service("select public.org_create($1,'acme-four','Acme Four')", [owner]), /ORG_LIMIT/);
const otherOrg = (await service("select * from public.org_create($1,'outsider-org','Outsider Org')", [outsider])).rows[0].id;
const bulkRows = JSON.stringify(Array.from({ length: 499 }, (_, i) => ({ email: `bulk-${i}@example.test`, display_name: `Bulk ${i}` })));
assert.equal((await service('select public.org_import_members($1,$2,$3::jsonb) as value', [outsider, otherOrg, bulkRows])).rows[0].value.created, 499);
await assert.rejects(() => service('select public.org_import_members($1,$2,$3::jsonb)', [outsider, otherOrg, JSON.stringify([{ email: 'over@example.test', display_name: 'Over' }])]), /ORG_MEMBER_LIMIT/);
const listed = (await service('select public.org_list($1) as value', [owner])).rows[0].value;
assert.equal(listed[0].organizationId, org);
await service("insert into public.organization_members(organization_id,email_normalized,display_name) values ($1,'member@example.test','Member')", [org]);
assert.equal((await service('select public.org_claim_members($1) as n', [member])).rows[0].n, 1);
const memberRow = (await service('select id from public.organization_members where organization_id=$1 and user_id=$2', [org, member])).rows[0].id;
const claimed = (await service('select status,user_id from public.organization_members where id=$1', [memberRow])).rows[0];
assert.equal(claimed.status, 'active');
assert.equal(String(claimed.user_id), member);
const ordinaryWorkspace = (await service('select public.org_workspace($1,$2) as value', [member, org])).rows[0].value;
assert.equal(ordinaryWorkspace.role, 'member');
assert.deepEqual(ordinaryWorkspace.members, []);
await service("select public.org_set_member($1,$2,$3,null,'admin')", [owner, org, memberRow]);
const otherAdmin = (await service("insert into public.organization_members(organization_id,user_id,email_normalized,display_name,status,role,claimed_at) values ($1,$2,'outsider@example.test','Other Admin','active','admin',now()) returning id", [org, outsider])).rows[0].id;
const ownerRow = (await service("select id from public.organization_members where organization_id=$1 and role='owner'", [org])).rows[0].id;
await assert.rejects(() => service("select public.org_set_member($1,$2,$3,'suspended')", [member, org, otherAdmin]), /ORG_FORBIDDEN/);
await assert.rejects(() => service("select public.org_set_member($1,$2,$3,'suspended')", [member, org, ownerRow]), /OWNER_REQUIRED|ORG_FORBIDDEN/);
await assert.rejects(() => service("select public.org_remove_member($1,$2,$3)", [member, org, otherAdmin]), /ORG_FORBIDDEN/);
await assert.rejects(() => service("select public.org_remove_member($1,$2,$3)", [member, org, ownerRow]), /ORG_FORBIDDEN/);
await assert.rejects(() => service("select public.org_set_member($1,$2,$3,'suspended')", [owner, otherOrg, memberRow]), /ORG_FORBIDDEN|OWNER_REQUIRED/);
const memberWorkspace = (await service('select public.org_workspace($1,$2) as value', [member, org])).rows[0].value;
assert.equal(memberWorkspace.role, 'admin');
assert.equal(memberWorkspace.members.length >= 2, true);
await assert.rejects(() => service('select public.org_workspace($1,$2)', [intruder, org]), /ORG_FORBIDDEN/);
await service("update auth.users set email='changed@example.test' where id=$1", [member]);
await assert.rejects(() => service('select public.org_workspace($1,$2)', [member, org]), /ORG_FORBIDDEN/);
await service("update auth.users set email='member@example.test' where id=$1", [member]);
await service("insert into public.organization_members(organization_id,email_normalized,display_name) values ($1,'member@example.test','duplicate')", [org]).catch(() => {});
assert.equal((await service("select public.org_claim_members($1) as n", [outsider])).rows[0].n, 0);
await assert.rejects(() => service("select public.org_set_member($1,$2,$3,'active','admin')", [member, org, memberRow]), /OWNER_REQUIRED|ORG_FORBIDDEN/);

const badRows = JSON.stringify([{ email: 'new@example.test', display_name: 'New', department: '' }, { email: 'bad@example.test', display_name: '', department: '' }]);
await assert.rejects(() => service('select public.org_import_members($1,$2,$3::jsonb)', [owner, org, badRows]), /CSV_INVALID/);
assert.equal((await scalar('select count(*)::int as n from public.organization_members where organization_id=$1 and email_normalized=$2', [org, 'new@example.test'])).n, 0);
const duplicateRows = JSON.stringify([{ email: 'new2@example.test', display_name: 'New' }, { email: 'new2@example.test', display_name: 'Again' }]);
await assert.rejects(() => service('select public.org_import_members($1,$2,$3::jsonb)', [owner, org, duplicateRows]), /CSV_INVALID/);
const email255 = 'a'.repeat(255) + '@x.test';
for (const invalidRows of ['null', '{}', '[]', '[null]', '[1]', '[{"email":null,"display_name":"x"}]', '[{"email":"x@example.test","display_name":"x","department":null}]', `[ {"email":"${email255}","display_name":"x"} ]`]) {
  await assert.rejects(() => service('select public.org_import_members($1,$2,$3::jsonb)', [owner, org, invalidRows]), /CSV_INVALID|CSV_LIMIT/);
}
for (const invalidPolicy of ['null', '[null]']) {
  await assert.rejects(() => service('select public.org_set_policy($1,$2,$3::jsonb,$4::jsonb)', [owner, org, invalidPolicy, JSON.stringify({ group_play: true, solo_play: true, theme_mix: false, audio: true, theme_tags: true })]), /POLICY_INVALID/);
}
await assert.rejects(() => service("select public.org_set_member($1,$2,$3,null,'owner')", [owner, org, memberRow]), /OWNER_REQUIRED/);

await service("update public.organizations set status='suspended' where id=$1", [org]);
assert.equal((await service('select public.org_list($1) as value', [owner])).rows[0].value.some((x) => x.organizationId === org), false);
assert.equal((await service('select public.org_claim_members($1) as n', [member])).rows[0].n, 0);
await service("update public.organizations set status='active' where id=$1", [org]);
await service("update public.organization_members set status='suspended' where id=$1", [memberRow]);
const pendingId = (await service("insert into public.organization_members(organization_id,email_normalized,display_name,status) values ($1,'claimable@example.test','Pending','suspended') returning id", [org])).rows[0].id;
assert.equal((await service('select public.org_claim_members($1) as n', [claimant])).rows[0].n, 0);
await service("select public.org_set_member($1,$2,$3,'active')", [owner, org, pendingId]);
assert.equal((await scalar('select status::text as status from public.organization_members where id=$1', [pendingId])).status, 'pending');
assert.equal((await service('select public.org_claim_members($1) as n', [claimant])).rows[0].n, 1);
const claimantRow = (await service('select id from public.organization_members where organization_id=$1 and user_id=$2', [org, claimant])).rows[0].id;
await service("select public.org_set_member($1,$2,$3,null,'admin')", [owner, org, claimantRow]);
const policyFlags = JSON.stringify({ group_play: true, solo_play: true, theme_mix: false, audio: true, theme_tags: true });
await service('select public.org_set_policy($1,$2,$3::jsonb,$4::jsonb)', [claimant, org, JSON.stringify(['team']), policyFlags]);
assert.equal(String((await scalar('select updated_by from public.organization_policies where organization_id=$1', [org])).updated_by), claimant);
await service('delete from auth.users where id=$1', [claimant]);
assert.equal((await scalar('select updated_by from public.organization_policies where organization_id=$1', [org])).updated_by, null);

await service('delete from auth.users where id=$1', [member]);
assert.equal((await scalar('select count(*)::int as n from public.organization_members where id=$1', [memberRow])).n, 0);
await service('select public.org_delete($1,$2)', [owner, org]);
assert.equal((await scalar('select count(*)::int as n from public.organization_members where organization_id=$1', [org])).n, 0);
assert.equal((await scalar('select count(*)::int as n from public.organization_policies where organization_id=$1', [org])).n, 0);
console.log('ORGANIZATIONS_PGLITE_ASSERTIONS_OK');
await db.close();
