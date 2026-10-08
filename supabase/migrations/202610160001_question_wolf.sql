begin;
alter table public.group_rooms drop constraint if exists group_rooms_game_type;
alter table public.group_rooms add constraint group_rooms_game_type
  check (game_type in ('cards','minority_topic','question_wolf'));
create table if not exists public.question_wolf_games (
  room_id uuid primary key references public.group_rooms(id) on delete cascade,
  pairs jsonb not null check (jsonb_typeof(pairs) = 'array' and jsonb_array_length(pairs) between 1 and 200),
  used_pairs jsonb not null default '[]'::jsonb check (jsonb_typeof(used_pairs) = 'array'),
  round_no integer not null default 0 check (round_no between 0 and 6),
  phase text not null default 'lobby' check (phase in ('lobby','confirm','answer','discussion','vote','result','ended')),
  updated_at timestamptz not null default now()
);
create table if not exists public.question_wolf_rounds (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.question_wolf_games(room_id) on delete cascade,
  round_no integer not null check (round_no between 1 and 6), majority_question text not null, minority_question text not null,
  assignments jsonb not null check (jsonb_typeof(assignments) = 'object'), confirmed jsonb not null default '{}'::jsonb,
  answer_order jsonb not null default '[]'::jsonb, answer_index integer not null default 0,
  discussion_started_at timestamptz, discussion_deadline timestamptz,
  status text not null default 'confirm' check (status in ('confirm','answer','discussion','vote','result','ended')),
  created_at timestamptz not null default now(), unique(room_id, round_no)
);
create table if not exists public.question_wolf_votes (
  round_id uuid not null references public.question_wolf_rounds(id) on delete cascade,
  voter_id uuid not null references public.group_members(id) on delete cascade,
  target_id uuid not null references public.group_members(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(round_id, voter_id)
);
create index if not exists question_wolf_rounds_room_idx on public.question_wolf_rounds(room_id, round_no);
create index if not exists question_wolf_votes_round_idx on public.question_wolf_votes(round_id);
alter table public.question_wolf_games enable row level security;
alter table public.question_wolf_rounds enable row level security;
alter table public.question_wolf_votes enable row level security;
revoke all on public.question_wolf_games, public.question_wolf_rounds, public.question_wolf_votes from anon, authenticated;
grant all on public.question_wolf_games, public.question_wolf_rounds, public.question_wolf_votes to service_role;
alter table public.question_wolf_games drop constraint if exists question_wolf_pairs_size;
alter table public.question_wolf_games add constraint question_wolf_pairs_size check (octet_length(pairs::text) <= 262144);
alter table public.question_wolf_rounds drop constraint if exists question_wolf_round_text_size;
alter table public.question_wolf_rounds add constraint question_wolf_round_text_size check (length(majority_question) <= 512 and length(minority_question) <= 512 and octet_length(assignments::text) <= 262144);
create or replace function public.question_wolf_create_room(p_host_user_id uuid,p_invite_hash text,p_host_secret_hash text,p_host_name text,p_expires_at timestamptz,p_pairs jsonb)
returns table(room_id uuid,host_member_id uuid) language plpgsql security definer set search_path=public as $$
declare r uuid;
m uuid;
cards jsonb;
begin
 if p_host_user_id is null or octet_length(p_pairs::text)>262144 or jsonb_typeof(p_pairs)<>'array' or jsonb_array_length(p_pairs)<6 or jsonb_array_length(p_pairs)>200 or exists(select 1 from jsonb_array_elements(p_pairs) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'majority')<>'string' or jsonb_typeof(x->'minority')<>'string' or nullif(x->>'majority','') is null or nullif(x->>'minority','') is null or length(x->>'majority')>512 or length(x->>'minority')>512 or x->>'majority'=x->>'minority') then raise exception 'INVALID_REQUEST';
end if;
cards := (select jsonb_agg(jsonb_build_object('id','question-wolf:'||((ord-1)::text),'text',pair->>'majority','r18',false,'sourceDeckId','question_wolf','participantRule','group') order by ord) from jsonb_array_elements(p_pairs) with ordinality x(pair,ord) where ord <= 40);
insert into public.group_rooms(host_user_id,invite_hash,deck_id,deck_name,cards,adult_only,member_count,expires_at,game_type) values(p_host_user_id,p_invite_hash,'question_wolf','質問ウルフ',cards,false,1,p_expires_at,'question_wolf') returning id into r;
insert into public.group_members(room_id,secret_hash,display_name,role,adult_confirmed) values(r,p_host_secret_hash,left(p_host_name,40),'host',true) returning id into m;
insert into public.question_wolf_games(room_id,pairs) values(r,p_pairs);
return query select r,m;
end;
$$;
revoke all on function public.question_wolf_create_room(uuid,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.question_wolf_create_room(uuid,text,text,text,timestamptz,jsonb) to service_role;
create or replace function public.question_wolf_expire_discussion(p_room_id uuid,p_round_no integer) returns void language plpgsql security definer set search_path=public as $$
declare room public.group_rooms;
game public.question_wolf_games;
r public.question_wolf_rounds;
changed boolean := false;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
if not found or room.game_type<>'question_wolf' or room.expires_at<=now() or room.status<>'playing' then raise exception 'QUESTION_WOLF_PHASE';
end if;
select * into game from public.question_wolf_games where room_id=p_room_id for update;
select * into r from public.question_wolf_rounds where room_id=p_room_id and round_no=p_round_no for update;
if not found or game.round_no<>p_round_no or game.phase<>'discussion' or r.status<>'discussion' then raise exception 'QUESTION_WOLF_STALE_ROUND';
end if;
if r.discussion_deadline <= now() then update public.question_wolf_rounds set status='vote' where id=r.id;
update public.question_wolf_games set phase='vote',updated_at=now() where room_id=p_room_id;
changed := true;
end if;
if changed then update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id;
end if;
end;
$$;
revoke all on function public.question_wolf_expire_discussion(uuid,integer) from public, anon, authenticated;
grant execute on function public.question_wolf_expire_discussion(uuid,integer) to service_role;
create or replace function public.question_wolf_finish(p_room_id uuid,p_round_no integer,p_member_id uuid,p_expected_revision bigint) returns void language plpgsql security definer set search_path=public as $$
declare room public.group_rooms;
game public.question_wolf_games;
r public.question_wolf_rounds;
m public.group_members;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
select * into game from public.question_wolf_games where room_id=p_room_id for update;
select * into r from public.question_wolf_rounds where room_id=p_room_id and round_no=p_round_no for update;
select * into m from public.group_members where id=p_member_id and room_id=p_room_id and role='host';
if not found or room.game_type<>'question_wolf' or room.expires_at<=now() or room.status<>'playing' or room.revision<>p_expected_revision or game.round_no<>p_round_no or r.round_no<>p_round_no then raise exception 'QUESTION_WOLF_STALE_ROUND';
end if;
delete from public.question_wolf_rounds where room_id=p_room_id;
update public.question_wolf_games set phase='ended',updated_at=now() where room_id=p_room_id;
update public.group_rooms set status='ended',revision=revision+1,updated_at=now() where id=p_room_id;
end;
$$;
revoke all on function public.question_wolf_finish(uuid,integer,uuid,bigint) from public, anon, authenticated;
grant execute on function public.question_wolf_finish(uuid,integer,uuid,bigint) to service_role;
create or replace function public.question_wolf_start_round(p_room_id uuid,p_round_no integer,p_majority text,p_minority text,p_assignments jsonb,p_used_pairs jsonb,p_expected_revision bigint) returns public.question_wolf_rounds language plpgsql security definer set search_path=public as $$
declare room public.group_rooms;
game public.question_wolf_games;
r public.question_wolf_rounds;
n integer;
minority_count integer;
selected jsonb;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
select * into game from public.question_wolf_games where room_id=p_room_id for update;
if not found or room.game_type<>'question_wolf' or room.expires_at<=now() or room.revision<>p_expected_revision then raise exception 'GROUP_STALE';
end if;
if p_round_no<1 or p_round_no>6 or p_majority=p_minority or game.round_no<>p_round_no-1 or (p_round_no=1 and room.status<>'lobby') or (p_round_no>1 and (room.status<>'playing' or game.phase<>'result')) then raise exception 'QUESTION_WOLF_PHASE';
end if;
select count(*) into n from public.group_members where room_id=p_room_id;
select count(*) into minority_count from jsonb_each(p_assignments) where value->>'role'='minority';
if n<3 or n>8 or (select count(*) from jsonb_object_keys(p_assignments))<>n or minority_count<>1 or exists(select 1 from jsonb_each(p_assignments) a where jsonb_typeof(a.value)<>'object' or jsonb_typeof(a.value->'role')<>'string' or jsonb_typeof(a.value->'question')<>'string' or coalesce(a.value->>'role','') not in ('majority','minority') or length(coalesce(a.value->>'question',''))=0 or length(a.value->>'question')>512 or (a.value->>'role'='majority' and a.value->>'question' is distinct from p_majority) or (a.value->>'role'='minority' and a.value->>'question' is distinct from p_minority) or not exists(select 1 from public.group_members m where m.room_id=p_room_id and m.id::text=a.key)) then raise exception 'GROUP_PARTICIPANTS';
end if;
if jsonb_typeof(p_used_pairs)<>'array' or jsonb_array_length(p_used_pairs)<>p_round_no or (select count(*) from jsonb_array_elements_text(p_used_pairs))<>p_round_no or (select count(distinct value) from jsonb_array_elements_text(p_used_pairs))<>p_round_no or exists(select 1 from jsonb_array_elements_text(p_used_pairs) x where (x::integer)<0 or (x::integer)>=jsonb_array_length(game.pairs)) or (p_round_no>1 and exists(select 1 from generate_series(0,p_round_no-2) i where p_used_pairs->i <> game.used_pairs->i)) then raise exception 'QUESTION_WOLF_PAIRS_INVALID';
end if;
selected := game.pairs -> ((p_used_pairs->>(p_round_no-1))::integer);
if selected is null or not ((p_majority=selected->>'majority' and p_minority=selected->>'minority') or (p_majority=selected->>'minority' and p_minority=selected->>'majority')) then raise exception 'QUESTION_WOLF_PAIRS_INVALID';
end if;
insert into public.question_wolf_rounds(room_id,round_no,majority_question,minority_question,assignments,answer_order,status) values(p_room_id,p_round_no,p_majority,p_minority,p_assignments,(select jsonb_agg(key order by random()) from jsonb_each(p_assignments)),'confirm') returning * into r;
update public.question_wolf_games set round_no=p_round_no,phase='confirm',used_pairs=p_used_pairs,updated_at=now() where room_id=p_room_id;
update public.group_rooms set status='playing',revision=revision+1,updated_at=now() where id=p_room_id;
return r;
end;
$$;
revoke all on function public.question_wolf_start_round(uuid,integer,text,text,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.question_wolf_start_round(uuid,integer,text,text,jsonb,jsonb,bigint) to service_role;
create or replace function public.question_wolf_confirm(p_room_id uuid,p_round_no integer,p_member_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare room public.group_rooms;
game public.question_wolf_games;
r public.question_wolf_rounds;
c jsonb;
total integer;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
select * into game from public.question_wolf_games where room_id=p_room_id for update;
select * into r from public.question_wolf_rounds where room_id=p_room_id and round_no=p_round_no for update;
if not found or room.game_type<>'question_wolf' or room.expires_at<=now() or room.status<>'playing' or game.round_no<>p_round_no or game.phase<>'confirm' or r.status<>'confirm' or not (r.assignments ? p_member_id::text) then raise exception 'QUESTION_WOLF_PHASE';
end if;
if r.confirmed ? p_member_id::text then return;
end if;
c:=r.confirmed || jsonb_build_object(p_member_id::text,true);
select count(*) into total from jsonb_object_keys(r.assignments);
update public.question_wolf_rounds set confirmed=c,status=case when (select count(*) from jsonb_object_keys(c))>=total then 'answer' else status end where id=r.id;
update public.question_wolf_games set phase=case when (select count(*) from jsonb_object_keys(c))>=total then 'answer' else phase end,updated_at=now() where room_id=p_room_id;
update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id;
end;
$$;
revoke all on function public.question_wolf_confirm(uuid,integer,uuid) from public, anon, authenticated;
grant execute on function public.question_wolf_confirm(uuid,integer,uuid) to service_role;
create or replace function public.question_wolf_answer(p_room_id uuid,p_round_no integer,p_member_id uuid,p_expected_revision bigint) returns void language plpgsql security definer set search_path=public as $$
declare room public.group_rooms;
game public.question_wolf_games;
r public.question_wolf_rounds;
who text;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
select * into game from public.question_wolf_games where room_id=p_room_id for update;
select * into r from public.question_wolf_rounds where room_id=p_room_id and round_no=p_round_no for update;
if not found or room.game_type<>'question_wolf' or room.expires_at<=now() or room.status<>'playing' or room.revision<>p_expected_revision or game.round_no<>p_round_no or game.phase<>'answer' or r.status<>'answer' then raise exception 'QUESTION_WOLF_PHASE';
end if;
who:=r.answer_order->>r.answer_index;
if who<>p_member_id::text and not exists(select 1 from public.group_members where id=p_member_id and room_id=p_room_id and role='host') then raise exception 'QUESTION_WOLF_TURN';
end if;
if r.answer_index+1 >= jsonb_array_length(r.answer_order) then update public.question_wolf_rounds set answer_index=answer_index+1,status='discussion',discussion_started_at=now(),discussion_deadline=now()+interval '120 seconds' where id=r.id;
update public.question_wolf_games set phase='discussion',updated_at=now() where room_id=p_room_id;
else update public.question_wolf_rounds set answer_index=answer_index+1 where id=r.id;
end if;
update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id;
end;
$$;
revoke all on function public.question_wolf_answer(uuid,integer,uuid,bigint) from public, anon, authenticated;
grant execute on function public.question_wolf_answer(uuid,integer,uuid,bigint) to service_role;
create or replace function public.question_wolf_open_vote(p_room_id uuid,p_round_no integer,p_member_id uuid,p_expected_revision bigint) returns void language plpgsql security definer set search_path=public as $$
declare room public.group_rooms;
game public.question_wolf_games;
r public.question_wolf_rounds;
m public.group_members;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
select * into game from public.question_wolf_games where room_id=p_room_id for update;
select * into r from public.question_wolf_rounds where room_id=p_room_id and round_no=p_round_no for update;
select * into m from public.group_members where id=p_member_id and room_id=p_room_id and role='host';
if not found or room.game_type<>'question_wolf' or room.expires_at<=now() or room.status<>'playing' or room.revision<>p_expected_revision or game.round_no<>p_round_no or game.phase<>'discussion' or r.status<>'discussion' or r.discussion_deadline>now() then raise exception 'QUESTION_WOLF_DISCUSSION_ACTIVE';
end if;
update public.question_wolf_rounds set status='vote' where id=r.id;
update public.question_wolf_games set phase='vote',updated_at=now() where room_id=p_room_id;
update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id;
end;
$$;
revoke all on function public.question_wolf_open_vote(uuid,integer,uuid,bigint) from public, anon, authenticated;
grant execute on function public.question_wolf_open_vote(uuid,integer,uuid,bigint) to service_role;
create or replace function public.question_wolf_cast_vote(p_room_id uuid,p_round_no integer,p_voter_id uuid,p_target_id uuid,p_expected_revision bigint) returns void language plpgsql security definer set search_path=public as $$
declare room public.group_rooms;
game public.question_wolf_games;
r public.question_wolf_rounds;
n integer;
total integer;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
select * into game from public.question_wolf_games where room_id=p_room_id for update;
select * into r from public.question_wolf_rounds where room_id=p_room_id and round_no=p_round_no for update;
if not found or room.game_type<>'question_wolf' or room.expires_at<=now() or room.status<>'playing' or game.round_no<>p_round_no or game.phase<>'vote' or r.round_no<>p_round_no or r.status<>'vote' or p_voter_id=p_target_id or not (r.assignments ? p_voter_id::text) or not (r.assignments ? p_target_id::text) then raise exception 'QUESTION_WOLF_VOTE_CLOSED';
end if;
if exists(select 1 from public.question_wolf_votes where round_id=r.id and voter_id=p_voter_id) then raise exception 'QUESTION_WOLF_ALREADY_VOTED';
end if;
insert into public.question_wolf_votes(round_id,voter_id,target_id) values(r.id,p_voter_id,p_target_id);
select count(*) into n from public.question_wolf_votes where round_id=r.id;
select count(*) into total from jsonb_object_keys(r.assignments);
if n>=total then update public.question_wolf_rounds set status='result' where id=r.id;
update public.question_wolf_games set phase='result',updated_at=now() where room_id=p_room_id;
end if;
update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id;
end;
$$;
revoke all on function public.question_wolf_cast_vote(uuid,integer,uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.question_wolf_cast_vote(uuid,integer,uuid,uuid,bigint) to service_role;
commit;
