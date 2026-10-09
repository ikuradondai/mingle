import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Local-only permission smoke test. It never connects to Supabase.
const db = new PGlite();
const orgSql = await readFile(new URL('../../supabase/migrations/202610140001_organizations.sql', import.meta.url), 'utf8');
const activitySql = await readFile(new URL('../../supabase/migrations/202610190001_business_activities.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000011';
const member = '00000000-0000-4000-8000-000000000012';
const admin = '00000000-0000-4000-8000-000000000013';
await db.exec(`create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}'::jsonb); create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; grant usage on schema public,auth to anon,authenticated,service_role; grant all on auth.users to service_role; insert into auth.users values ('${owner}','owner@example.test',now(),'{}'),('${member}','member@example.test',now(),'{}'),('${admin}','admin@example.test',now(),'{}');`);
await db.exec(orgSql);
await db.exec(activitySql);
async function service(sql, params = []) { await db.exec('set role service_role'); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } }
async function denied(role, sql) { await db.exec(`set role ${role}`); let error; try { await db.exec(sql); } catch (e) { error = e; } await db.exec('reset role'); assert.equal(error?.code, '42501'); }
for (const role of ['anon', 'authenticated']) {
  await denied(role, `select public.org_content_policy('${owner}','00000000-0000-0000-0000-000000000001')`);
  await denied(role, `select public.org_quiz_list('${owner}','00000000-0000-0000-0000-000000000001',false)`);
}
for (const fn of ['org_content_policy(uuid,uuid)', 'org_set_content_policy(uuid,uuid,boolean,boolean,boolean)', 'org_quiz_list(uuid,uuid,boolean)', 'org_quiz_create(uuid,uuid,text,text,jsonb,text)', 'org_quiz_update(uuid,uuid,uuid,text,text,jsonb,text)']) {
  assert.equal((await service(`select has_function_privilege('service_role','public.${fn}','execute') as ok`)).rows[0].ok, true);
  for (const role of ['anon', 'authenticated']) assert.equal((await service(`select has_function_privilege('${role}','public.${fn}','execute') as ok`)).rows[0].ok, false);
}
const org = (await service("select (public.org_create($1,'activity-org','Activity Org')).id", [owner])).rows[0].id;
const otherOrg = (await service("select (public.org_create($1,'other-org','Other Org')).id", [member])).rows[0].id;
await service("insert into public.organization_members(organization_id,user_id,email_normalized,display_name,status,role,claimed_at) values ($1,$2,'member@example.test','Member','active','member',now())", [org, member]);
await service("insert into public.organization_members(organization_id,user_id,email_normalized,display_name,status,role,claimed_at) values ($1,$2,'admin@example.test','Admin','active','admin',now())", [org, admin]);
assert.deepEqual((await service('select public.org_content_policy($1,$2) as value', [member, org])).rows[0].value, { businessActivities: true, customQuiz: true, generalQuiz: true });
await assert.rejects(() => service('select public.org_content_policy($1,$2)', [owner, otherOrg]), /ORG_FORBIDDEN/);
await assert.rejects(() => service("select public.org_quiz_create($1,$2,'x','',$3::jsonb,'draft')", [member, org, '[]']), /ORG_FORBIDDEN|QUIZ_INVALID/);
await assert.rejects(() => service("select public.org_quiz_create($1,$2,'x','',$3::jsonb,'draft')", [owner, org, '[{"question":"","answer":"a"}]']), /QUIZ_INVALID/);
await assert.rejects(() => service("select public.org_quiz_create($1,$2,'x','',$3::jsonb,null)", [owner, org, '[{"question":"q","answer":"a"}]']), /QUIZ_INVALID/);
await assert.rejects(() => service("select public.org_quiz_create($1,$2,'x','',$3::jsonb,'draft')", [owner, org, JSON.stringify([{ question: 'q'.repeat(1001), answer: 'a' }])]), /QUIZ_INVALID/);
await assert.rejects(() => service("select public.org_quiz_create($1,$2,'x','',$3::jsonb,'draft')", [owner, otherOrg, '[{"question":"q","answer":"a"}]']), /ORG_FORBIDDEN/);
const draft = (await service("select public.org_quiz_create($1,$2,'<b>Draft</b>','desc',$3::jsonb,'draft') as value", [owner, org, '[{"question":"Q","answer":"A","explanation":"E"}]'])).rows[0].value;
const published = (await service("select public.org_quiz_create($1,$2,'Published','desc',$3::jsonb,'published') as value", [owner, org, '[{"question":"Q2","answer":"A2"}]'])).rows[0].value;
assert.ok(draft);
assert.ok(published);
assert.equal(draft.status, 'draft');
assert.equal(published.status, 'published');
const memberList = (await service('select public.org_quiz_list($1,$2,false) as value', [member, org])).rows[0].value;
assert.deepEqual(memberList.map((q) => q.id), [published.id]);
await assert.rejects(() => service("select public.org_quiz_update($1,$2,$3,'x','',$4::jsonb,'published')", [member, org, draft.id, '[{"question":"q","answer":"a"}]']), /ORG_FORBIDDEN/);
const updated = (await service("select public.org_quiz_update($1,$2,$3,'Published again','',$4::jsonb,'draft') as value", [owner, org, published.id, '[{"question":"<i>Q</i>","answer":"A"}]'])).rows[0].value;
assert.equal(updated.status, 'draft');
assert.equal(updated.questions[0].question, '<i>Q</i>');
const adminQuiz = (await service("select public.org_quiz_create($1,$2,'Admin quiz','',$3::jsonb,'published') as value", [admin, org, '[{"question":"q","answer":"a"}]'])).rows[0].value;
await service('delete from auth.users where id=$1', [admin]);
const audit = (await service('select created_by,updated_by from public.organization_quizzes where id=$1', [adminQuiz.id])).rows[0];
assert.equal(audit.created_by, null);
assert.equal(audit.updated_by, null);
await service('select public.org_set_content_policy($1,$2,false,false,false)', [owner, org]);
assert.deepEqual((await service('select public.org_content_policy($1,$2) as value', [owner, org])).rows[0].value, { businessActivities: false, customQuiz: false, generalQuiz: false });
await assert.rejects(() => service('select public.org_quiz_list($1,$2,false)', [owner, org]), /FEATURE_DISABLED/);
await assert.rejects(() => service("select public.org_quiz_create($1,$2,'x','',$3::jsonb,null)", [owner, org, '[{"question":"q","answer":"a"}]']), /FEATURE_DISABLED/);
console.log('business activities RPC permissions verified on PGlite');
