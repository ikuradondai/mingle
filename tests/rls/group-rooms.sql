\set ON_ERROR_STOP on
begin;
create temp table group_test_context(owner_id uuid, room_id uuid, host_member_id uuid);
grant all on group_test_context to service_role;
set role anon;
do $$ begin
  begin perform * from public.group_rooms; raise exception 'anon read allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.group_members; raise exception 'anon member read allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.group_rooms(host_user_id,invite_hash,deck_id,deck_name,cards) values(gen_random_uuid(),'x','d','d','[]'::jsonb); raise exception 'anon room write allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.group_members(room_id,secret_hash,display_name) values(gen_random_uuid(),'x','n'); raise exception 'anon member write allowed'; exception when insufficient_privilege then null; end;
  begin perform public.group_create_room(gen_random_uuid(),'x','d','d','[]'::jsonb,false,'h','n',now()); raise exception 'anon create allowed'; exception when insufficient_privilege then null; end;
  begin perform public.group_join_member(gen_random_uuid(),'x','n',false); raise exception 'anon join allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin perform * from public.group_rooms; raise exception 'authenticated room read allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.group_members; raise exception 'authenticated read allowed'; exception when insufficient_privilege then null; end;
  begin update public.group_rooms set deck_name='x'; raise exception 'authenticated room write allowed'; exception when insufficient_privilege then null; end;
  begin update public.group_members set display_name='x'; raise exception 'authenticated member write allowed'; exception when insufficient_privilege then null; end;
  begin perform public.group_create_room(gen_random_uuid(),'x','d','d','[]'::jsonb,false,'h','n',now()); raise exception 'authenticated create allowed'; exception when insufficient_privilege then null; end;
  begin perform public.group_join_member(gen_random_uuid(),'x','n',false); raise exception 'authenticated join allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into group_test_context(owner_id,room_id,host_member_id)
select '11111111-1111-4111-8111-111111111111',room_id,host_member_id
from public.group_create_room('11111111-1111-4111-8111-111111111111','invite-1','date','Test',
 (select jsonb_agg(jsonb_build_object('id','q'||i,'text','Q'||i)) from generate_series(1,6)i),false,'host-hash','Host',now()+interval '24 hours');
do $$ declare n int; begin select member_count into n from public.group_rooms where id=(select room_id from group_test_context); if n is distinct from 1 then raise exception 'host count %',n; end if; end $$;
do $$ declare i int; r uuid; m public.group_members; begin select room_id into r from group_test_context; for i in 1..7 loop select * into m from public.group_join_member(r,'guest-'||i,'Guest '||i,false); end loop; begin select * into m from public.group_join_member(r,'guest-9','Guest 9',false); raise exception 'ninth join allowed'; exception when others then if sqlerrm<>'GROUP_FULL' then raise; end if; end; end $$;
do $$ declare r uuid; a public.group_members; b public.group_members; n1 int; n2 int; begin select room_id into r from group_test_context; select member_count into n1 from public.group_rooms where id=r; select * into a from public.group_join_member(r,'guest-1','changed',false); select member_count into n2 from public.group_rooms where id=r; select * into b from public.group_members where id=a.id; if n1 is distinct from n2 or a.id is distinct from b.id then raise exception 'retry changed membership'; end if; end $$;
insert into group_test_context(owner_id,room_id,host_member_id)
select '11111111-1111-4111-8111-111111111111',room_id,host_member_id
from public.group_create_room('11111111-1111-4111-8111-111111111111','start-invite','date','Start',(select jsonb_agg(jsonb_build_object('id','s'||i,'text','S'||i)) from generate_series(1,6)i),false,'start-host','Start Host',now()+interval '24 hours');
update public.group_rooms set status='playing' where invite_hash='start-invite';
do $$ declare r uuid; m public.group_members; begin select id into r from public.group_rooms where invite_hash='start-invite'; select * into m from public.group_join_member(r,'new-late','Late',false); raise exception 'late join allowed'; exception when others then if sqlerrm<>'GROUP_ALREADY_STARTED' then raise; end if; end $$;
update public.group_rooms set status='playing' where invite_hash='invite-1';
do $$ declare r uuid; m public.group_members; begin select id into r from public.group_rooms where invite_hash='invite-1'; select * into m from public.group_join_member(r,'guest-1','Guest 1',false); begin select * into m from public.group_join_member(r,'new-late','Late',false); raise exception 'late join allowed'; exception when others then if sqlerrm<>'GROUP_ALREADY_STARTED' then raise; end if; end; end $$;
-- Adult consent and expiry are checked by separate rooms.
insert into group_test_context(owner_id,room_id,host_member_id)
select '11111111-1111-4111-8111-111111111111',room_id,host_member_id
from public.group_create_room('11111111-1111-4111-8111-111111111111','adult-invite','adult','Adult',
 (select jsonb_agg(jsonb_build_object('id','a'||i,'text','A'||i,'r18',true)) from generate_series(1,6)i),true,'adult-host','Adult Host',now()+interval '24 hours');
do $$ declare r uuid; m public.group_members; begin select id into r from public.group_rooms where invite_hash='adult-invite'; begin select * into m from public.group_join_member(r,'adult-guest','Adult Guest',false); raise exception 'adult join without consent'; exception when others then if sqlerrm<>'ADULT_CONSENT_REQUIRED' then raise; end if; end; select * into m from public.group_join_member(r,'adult-guest','Adult Guest',true); if not m.adult_confirmed then raise exception 'consent not stored'; end if; end $$;
insert into group_test_context(owner_id,room_id,host_member_id)
select '11111111-1111-4111-8111-111111111111',room_id,host_member_id
from public.group_create_room('11111111-1111-4111-8111-111111111111','expired-invite','date','Expired',
 (select jsonb_agg(jsonb_build_object('id','e'||i,'text','E'||i)) from generate_series(1,6)i),false,'expired-host','Expired Host',now()-interval '1 minute');
do $$ declare r uuid; m public.group_members; begin select id into r from public.group_rooms where invite_hash='expired-invite'; begin select * into m from public.group_join_member(r,'expired-guest','Expired Guest',false); raise exception 'expired join allowed'; exception when others then if sqlerrm<>'GROUP_EXPIRED' then raise; end if; end; end $$;
delete from auth.users where id='11111111-1111-4111-8111-111111111111';
do $$ begin if exists(select 1 from public.group_rooms where host_user_id='11111111-1111-4111-8111-111111111111') then raise exception 'room cascade failed'; end if; if exists(select 1 from public.group_members) then raise exception 'member cascade failed'; end if; end $$;
reset role;
rollback;



