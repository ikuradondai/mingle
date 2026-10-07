-- PREFLIGHT: temporary session tables only; persistent data is read-only. Do not run as a migration.
--
-- This script writes only temporary tables in the current session. It does not
-- insert, update, or delete rows in any persistent application table.
-- The script returns counts and presence flags only. It does not select card
-- text, tokens, owner IDs, venue IDs, room IDs, or other row identifiers.
-- Missing tables are reported as "missing" instead of aborting the check.

create temporary table if not exists security_preflight_results (
  table_name text primary key,
  table_status text not null,
  row_count bigint,
  bad_snapshot_shape bigint,
  card_count_out_of_range bigint,
  card_count_mismatch bigint,
  snapshot_over_64k bigint,
  card_text_over_300 bigint,
  duplicate_card_ids bigint,
  r18_card_without_adult_only bigint,
  plaintext_token_rows bigint,
  max_owner_or_venue_rows bigint,
  max_active_unexpired_room_owner_rows bigint,
  note text
);

create temporary table if not exists security_preflight_privileges (
  object_type text not null,
  object_name text not null,
  grantee text not null,
  privilege text not null
);

truncate pg_temp.security_preflight_results, pg_temp.security_preflight_privileges;

do $$
declare
  t text;
begin
  foreach t in array array['shared_sets', 'venue_sets', 'group_rooms'] loop
    if to_regclass('public.' || t) is null then
      insert into pg_temp.security_preflight_results(table_name, table_status, note)
      values (t, 'missing', 'table does not exist')
      on conflict (table_name) do nothing;
    elsif t = 'shared_sets' then
      execute $sql$
        insert into pg_temp.security_preflight_results
        select 'shared_sets', 'present', count(*)::bigint,
          count(*) filter (where jsonb_typeof(cards) is distinct from 'array'),
          count(*) filter (where case when jsonb_typeof(cards) = 'array' then jsonb_array_length(cards) else -1 end not between 6 and 40),
          count(*) filter (where card_count is distinct from case when jsonb_typeof(cards) = 'array' then jsonb_array_length(cards) else -1 end),
          count(*) filter (where octet_length(coalesce(cards, 'null'::jsonb)::text) > 65536),
          count(*) filter (where jsonb_typeof(cards) = 'array' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e where char_length(coalesce(e->>'text', '')) > 300)),
          count(*) filter (where jsonb_typeof(cards) = 'array' and exists (select 1 from (select e->>'id' as id from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e) ids group by id having count(*) > 1)),
          count(*) filter (where coalesce(adult_only, false) = false and jsonb_typeof(cards) = 'array' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e where e->>'r18' = 'true')),
          count(*) filter (where token is not null and btrim(token) <> ''),
          coalesce((select max(n) from (select owner_id, count(*)::bigint n from public.shared_sets group by owner_id) owners), 0),
          0::bigint,
          'counts only'
        from public.shared_sets
      $sql$;
    elsif t = 'venue_sets' then
      execute $sql$
        insert into pg_temp.security_preflight_results
        select 'venue_sets', 'present', count(*)::bigint,
          count(*) filter (where jsonb_typeof(cards) is distinct from 'array'),
          count(*) filter (where case when jsonb_typeof(cards) = 'array' then jsonb_array_length(cards) else -1 end not between 6 and 40),
          count(*) filter (where card_count is distinct from case when jsonb_typeof(cards) = 'array' then jsonb_array_length(cards) else -1 end),
          count(*) filter (where octet_length(coalesce(cards, 'null'::jsonb)::text) > 65536),
          count(*) filter (where jsonb_typeof(cards) = 'array' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e where char_length(coalesce(e->>'text', '')) > 300)),
          count(*) filter (where jsonb_typeof(cards) = 'array' and exists (select 1 from (select e->>'id' as id from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e) ids group by id having count(*) > 1)),
          count(*) filter (where coalesce(adult_only, false) = false and jsonb_typeof(cards) = 'array' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e where e->>'r18' = 'true')),
          0::bigint,
          coalesce((select max(n) from (select venue_id, count(*)::bigint n from public.venue_sets group by venue_id) venues), 0),
          0::bigint,
          'counts only'
        from public.venue_sets
      $sql$;
    else
      execute $sql$
        insert into pg_temp.security_preflight_results
        select 'group_rooms', 'present', count(*)::bigint,
          count(*) filter (where jsonb_typeof(cards) is distinct from 'array'),
          count(*) filter (where case when jsonb_typeof(cards) = 'array' then jsonb_array_length(cards) else -1 end not between 6 and 40),
          0::bigint,
          count(*) filter (where octet_length(coalesce(cards, 'null'::jsonb)::text) > 65536),
          count(*) filter (where jsonb_typeof(cards) = 'array' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e where char_length(coalesce(e->>'text', '')) > 300)),
          count(*) filter (where jsonb_typeof(cards) = 'array' and exists (select 1 from (select e->>'id' as id from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e) ids group by id having count(*) > 1)),
          count(*) filter (where coalesce(adult_only, false) = false and jsonb_typeof(cards) = 'array' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cards) = 'array' then cards else '[]'::jsonb end) e where e->>'r18' = 'true')),
          0::bigint,
          0::bigint,
          coalesce((select max(n) from (select host_user_id, count(*)::bigint n from public.group_rooms where expires_at > now() and status <> 'ended' group by host_user_id) owners), 0),
          'counts only; invite_hash is stored as a hash, not a plaintext token'
        from public.group_rooms
      $sql$;
    end if;
  end loop;
end
$$;

insert into pg_temp.security_preflight_privileges(object_type, object_name, grantee, privilege)
select 'table', table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('shared_sets', 'venue_sets', 'group_rooms')
  and grantee in ('anon', 'authenticated', 'service_role');

insert into pg_temp.security_preflight_privileges(object_type, object_name, grantee, privilege)
select 'function', routine_name, grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in ('snapshot_cards_valid', 'snapshot_cards_adult', 'shared_sets_owner_cap_guard', 'venue_sets_owner_cap_guard')
  and grantee in ('anon', 'authenticated', 'service_role');

-- Emit one result so SQL editors that show only the final result still retain
-- both data checks and privilege/function presence information.
select jsonb_build_object(
  'tables', coalesce((select jsonb_agg(to_jsonb(r) order by r.table_name) from pg_temp.security_preflight_results r), '[]'::jsonb),
  'privileges', coalesce((select jsonb_agg(to_jsonb(p) order by p.object_type, p.object_name, p.grantee, p.privilege) from pg_temp.security_preflight_privileges p), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(jsonb_build_object('function_name', p.proname, 'function_exists', true) order by p.proname)
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public'
                           and p.proname in ('snapshot_cards_valid', 'snapshot_cards_adult', 'shared_sets_owner_cap_guard', 'venue_sets_owner_cap_guard')), '[]'::jsonb)
) as security_preflight;
