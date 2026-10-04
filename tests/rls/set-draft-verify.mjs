import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const siteRoot =
  process.env.MINGLE_SITE_ROOT || new URL("../..", import.meta.url).pathname;
const db = new PGlite();
await db.waitReady;
const q = (s, p) => db.query(s, p);
const owner = "11111111-1111-1111-1111-111111111111",
  other = "22222222-2222-2222-2222-222222222222";
const sixStatic = Array.from({ length: 6 }, (_, i) => ({
  kind: "saved",
  cardId: "date-0" + (i + 1),
}));
const id = "00000000-0000-0000-0000-000000000001";
async function role(name, user) {
  await db.exec(`set role ${name}`);
  if (user)
    await q("select set_config($1,$2,false)", ["request.jwt.claim.sub", user]);
}
async function expectReject(fn) {
  await assert.rejects(fn);
}
try {
  await db.exec(
    `create schema auth; create table auth.users(id uuid primary key); create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$; create role anon; create role authenticated; create role service_role bypassrls;`,
  );
  for (const file of [
    "202610020001_accounts.sql",
    "202610030001_custom_cards.sql",
    "202610060001_set_drafts.sql",
  ])
    await db.exec(
      await readFile(join(siteRoot, "supabase", "migrations", file), "utf8"),
    );
  await db.exec(
    `grant usage,create on schema auth, public to postgres, service_role, authenticated; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant all on auth.users to service_role; grant select,insert,update,delete on public.my_set_drafts,public.my_sets,public.custom_cards to authenticated; grant execute on function public.complete_my_set_draft(uuid,uuid,jsonb) to service_role;`,
  );
  await q("insert into auth.users values ($1),($2)", [owner, other]);
  await role("service_role");
  await db.exec("set role authenticated");
  await q("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  for (const malformed of [
    [{ kind: "custom", text: "missing origin", r18: false }],
    [{ kind: "custom", text: "null origin", r18: false, origin: null }],
    [{ kind: "saved", cardId: "date-01", extra: true }],
  ])
    await expectReject(() =>
      q(
        "insert into public.my_set_drafts(user_id,name,items) values ($1,$2,$3::jsonb)",
        [owner, "malformed", JSON.stringify(malformed)],
      ),
    );
  await role("service_role");
  const foreignCard = (
    await q(
      "insert into public.custom_cards(user_id,text,r18) values ($1,$2,false) returning id",
      [other, "foreign card"],
    )
  ).rows[0].id;
  await expectReject(() =>
    q(
      "insert into public.my_set_drafts(user_id,name,items) values ($1,$2,$3::jsonb)",
      [
        owner,
        "foreign",
        JSON.stringify([
          { kind: "saved", cardId: "custom:" + foreignCard },
          ...sixStatic.slice(0, 5),
        ]),
      ],
    ),
  );
  await q(
    "insert into public.my_sets(user_id,name,card_ids) values ($1,$2,$3)",
    [owner, "ready", sixStatic.map((x) => x.cardId)],
  );
  await q(
    "insert into public.my_set_drafts(id,user_id,name,items) values ($1,$2,$3,$4::jsonb)",
    [id, owner, "draft", JSON.stringify(sixStatic)],
  );
  await role("authenticated", owner);
  assert.equal(
    (await q("select count(*)::int n from public.my_set_drafts")).rows[0].n,
    1,
  );
  await role("authenticated", other);
  assert.equal(
    (await q("select count(*)::int n from public.my_set_drafts")).rows[0].n,
    0,
  );
  await expectReject(() =>
    q(
      "insert into public.my_set_drafts(user_id,name,items) values ($1,$2,$3::jsonb)",
      [owner, "bad", JSON.stringify(sixStatic)],
    ),
  );
  await role("authenticated", owner);
  await expectReject(() =>
    q("select public.complete_my_set_draft($1::uuid,$2::uuid,$3::jsonb)", [
      id,
      owner,
      JSON.stringify(sixStatic),
    ]),
  );
  await role("service_role");
  const result = await q(
    "select public.complete_my_set_draft($1::uuid,$2::uuid,$3::jsonb)",
    [id, owner, JSON.stringify(sixStatic)],
  );
  assert.equal(result.rows.length, 1);
  assert.equal(
    (
      await q("select count(*)::int n from public.my_set_drafts where id=$1", [
        id,
      ])
    ).rows[0].n,
    0,
  );
  const readyId = (
    await q("select id from public.my_sets where user_id=$1 limit 1", [owner])
  ).rows[0].id;
  const sourceDraft = "00000000-0000-0000-0000-000000000006";
  await q(
    "insert into public.my_set_drafts(id,user_id,source_set_id,name,items) values ($1,$2,$3,$4,$5::jsonb)",
    [sourceDraft, owner, readyId, "edited", JSON.stringify(sixStatic)],
  );
  const sourceResult = await q(
    "select public.complete_my_set_draft($1::uuid,$2::uuid,$3::jsonb)",
    [sourceDraft, owner, JSON.stringify(sixStatic)],
  );
  assert.equal(sourceResult.rows[0].complete_my_set_draft.id, readyId);
  assert.equal(
    (await q("select name from public.my_sets where id=$1", [readyId])).rows[0]
      .name,
    "edited",
  );
  const shortId = "00000000-0000-0000-0000-000000000002";
  await q(
    "insert into public.my_set_drafts(id,user_id,name,items) values ($1,$2,$3,$4::jsonb)",
    [shortId, owner, "short", JSON.stringify(sixStatic.slice(0, 5))],
  );
  await expectReject(() =>
    q("select public.complete_my_set_draft($1::uuid,$2::uuid,$3::jsonb)", [
      shortId,
      owner,
      JSON.stringify(sixStatic.slice(0, 5)),
    ]),
  );
  assert.equal(
    (
      await q("select count(*)::int n from public.my_set_drafts where id=$1", [
        shortId,
      ])
    ).rows[0].n,
    1,
  );
  const refCard = (
    await q(
      "insert into public.custom_cards(user_id,text,r18) values ($1,$2,false) returning id",
      [owner, "draft reference"],
    )
  ).rows[0].id;
  const refId = "custom:" + refCard;
  const refDraft = "00000000-0000-0000-0000-000000000005";
  const refItems = [{ kind: "saved", cardId: refId }, ...sixStatic.slice(0, 5)];
  await q(
    "insert into public.my_set_drafts(id,user_id,name,items) values ($1,$2,$3,$4::jsonb)",
    [refDraft, owner, "reference", JSON.stringify(refItems)],
  );
  await role("authenticated", owner);
  await expectReject(() =>
    q("delete from public.custom_cards where id=$1", [refCard]),
  );
  await role("service_role");
  const rollbackId = "00000000-0000-0000-0000-000000000007";
  const rollbackItems = Array.from({ length: 6 }, (_, i) => ({
    kind: "custom",
    text: `rollback ${i}`,
    r18: false,
    origin: "user",
  }));
  await q(
    "insert into public.my_set_drafts(id,user_id,source_set_id,name,items) values ($1,$2,(select id from public.my_sets where user_id=$2 limit 1),$3,$4::jsonb)",
    [rollbackId, owner, "rollback", JSON.stringify(rollbackItems)],
  );
  await db.exec("set role postgres");
  await db.exec(
    "create or replace function public.fail_set_write() returns trigger language plpgsql as $$ begin raise exception 'ROLLBACK_SENTINEL'; end; $$; create trigger fail_set_write before update on public.my_sets for each row execute function public.fail_set_write();",
  );
  await role("service_role");
  const beforeRollback = (
    await q(
      "select count(*)::int n from public.custom_cards where user_id=$1",
      [owner],
    )
  ).rows[0].n;
  await expectReject(() =>
    q("select public.complete_my_set_draft($1::uuid,$2::uuid,$3::jsonb)", [
      rollbackId,
      owner,
      JSON.stringify(rollbackItems),
    ]),
  );
  assert.equal(
    (
      await q(
        "select count(*)::int n from public.custom_cards where user_id=$1",
        [owner],
      )
    ).rows[0].n,
    beforeRollback,
  );
  assert.equal(
    (
      await q("select count(*)::int n from public.my_set_drafts where id=$1", [
        rollbackId,
      ])
    ).rows[0].n,
    1,
  );
  await db.exec(
    "set role postgres",
  );
  await db.exec(
    "drop trigger fail_set_write on public.my_sets; drop function public.fail_set_write();",
  );
  await role("service_role");
  const customId = "00000000-0000-0000-0000-000000000003";
  const customItems = Array.from({ length: 6 }, (_, i) => ({
    kind: "custom",
    text: `custom question ${i}`,
    r18: false,
    origin: "user",
  }));
  await q(
    "insert into public.my_set_drafts(id,user_id,name,items) values ($1,$2,$3,$4::jsonb)",
    [customId, owner, "custom", JSON.stringify(customItems)],
  );
  const customResult = await q(
    "select public.complete_my_set_draft($1::uuid,$2::uuid,$3::jsonb)",
    [customId, owner, JSON.stringify(customItems)],
  );
  assert.equal(customResult.rows.length, 1);
  assert.equal(
    (
      await q(
        "select count(*)::int n from public.custom_cards where user_id=$1",
        [owner],
      )
    ).rows[0].n,
    7,
  );
  const badId = "00000000-0000-0000-0000-000000000004";
  await q(
    "insert into public.my_set_drafts(id,user_id,name,items) values ($1,$2,$3,$4::jsonb)",
    [badId, owner, "bad", JSON.stringify(sixStatic)],
  );
  await expectReject(() =>
    q("select public.complete_my_set_draft($1::uuid,$2::uuid,$3::jsonb)", [
      badId,
      owner,
      JSON.stringify(
        sixStatic.slice(0, 5).concat({ kind: "saved", cardId: "date-99" }),
      ),
    ]),
  );
  assert.equal(
    (
      await q("select count(*)::int n from public.my_set_drafts where id=$1", [
        badId,
      ])
    ).rows[0].n,
    1,
  );
  await q("insert into public.favorites(user_id,card_id) values ($1,$2)", [
    owner,
    "date-01",
  ]);
  await q("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("set role service_role");
  await q("delete from auth.users where id=$1", [owner]);
  for (const table of ["favorites", "my_sets", "custom_cards", "my_set_drafts"])
    assert.equal(
      (
        await q(
          `select count(*)::int n from public.${table} where user_id=$1`,
          [owner],
        )
      ).rows[0].n,
      0,
    );
  console.log("PGLITE_SET_DRAFT_FULL_RLS_RPC_OK");
} catch (e) {
  console.error(e.stack || e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
