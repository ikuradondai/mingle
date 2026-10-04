-- Repeatable venue MVP RLS/tenant smoke test. Run after the migration in a disposable Postgres.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002') on conflict do nothing;
insert into public.venues(id,owner_id,name) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','A店'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','B店') on conflict do nothing;
insert into public.venue_sets(id,venue_id,name,cards,card_count) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Aテーマ','[{"id":"a1"},{"id":"a2"},{"id":"a3"},{"id":"a4"},{"id":"a5"},{"id":"a6"}]',6),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Bテーマ','[{"id":"b1"},{"id":"b2"},{"id":"b3"},{"id":"b4"},{"id":"b5"},{"id":"b6"}]',6) on conflict do nothing;
insert into public.venue_tables(id,venue_id,label,token_hash,token_ciphertext) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A卓','ha','cipher-a'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','B卓','hb','cipher-b') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin if (select count(*) from public.venues) <> 1 then raise exception 'owner A boundary failed'; end if; if (select count(*) from public.venue_sets) <> 1 then raise exception 'owner A set boundary failed'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin if (select count(*) from public.venues) <> 1 then raise exception 'owner B boundary failed'; end if; if (select count(*) from public.venue_sets) <> 1 then raise exception 'owner B set boundary failed'; end if; end $$;
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.venues; raise exception 'anon read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin insert into public.venues(owner_id,name) values ('00000000-0000-0000-0000-000000000001','匿名禁止'); raise exception 'anon insert unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare changed integer; begin update public.venues set name='不正更新' where id='10000000-0000-0000-0000-000000000001'; get diagnostics changed = row_count; if changed <> 0 then raise exception 'cross owner update succeeded'; end if; end $$;
reset role;
-- Public events are service-role writes; composite FKs reject a venue/set cross-pair.
do $$ begin
  begin insert into public.venue_usage_events(venue_id,venue_set_id,table_id,session_hash,event_type,round_index) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','cross','started',1); raise exception 'cross tenant insert unexpectedly succeeded';
  exception when foreign_key_violation then null; end;
end $$;
do $$ begin
  begin insert into public.venue_usage_events(venue_id,venue_set_id,table_id,session_hash,event_type,round_index) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','cross-table','started',1); raise exception 'cross tenant table insert unexpectedly succeeded';
  exception when foreign_key_violation then null; end;
end $$;
insert into public.venue_usage_events(venue_id,venue_set_id,table_id,session_hash,event_type,round_index) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','session','started',1);
insert into public.venue_usage_events(venue_id,venue_set_id,table_id,session_hash,event_type,round_index) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','session','started',1) on conflict do nothing;
insert into public.venue_usage_events(venue_id,venue_set_id,table_id,session_hash,event_type,round_index) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','session','completed_round',1);
insert into public.venue_usage_events(venue_id,venue_set_id,table_id,session_hash,event_type,round_index) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','session','completed_round',1) on conflict do nothing;
do $$ begin if (select count(*) from public.venue_usage_events) <> 2 then raise exception 'duplicate event was not deduped'; end if; end $$;
select count(*) as events_before_account_delete from public.venue_usage_events;
delete from auth.users where id='00000000-0000-0000-0000-000000000001';
do $$ begin if (select count(*) from public.venues where id='10000000-0000-0000-0000-000000000001') <> 0 then raise exception 'owner cascade failed'; end if; if (select count(*) from public.venue_usage_events) <> 0 then raise exception 'event cascade failed'; end if; end $$;
select 'venue rls smoke passed' as result;
rollback;
