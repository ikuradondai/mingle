begin;
alter table public.group_rooms add column if not exists game_type text not null default 'cards';
alter table public.group_rooms drop constraint if exists group_rooms_game_type;
alter table public.group_rooms add constraint group_rooms_game_type check (game_type in ('cards','minority_topic'));
create table if not exists public.minority_games (room_id uuid primary key references public.group_rooms(id) on delete cascade, pairs jsonb not null check (jsonb_typeof(pairs) = 'array' and jsonb_array_length(pairs) between 1 and 200), used_pairs jsonb not null default '[]'::jsonb check (jsonb_typeof(used_pairs) = 'array'), round_no integer not null default 0 check (round_no between 0 and 6), phase text not null default 'lobby' check (phase in ('lobby','confirm','talk','vote','result','ended')), updated_at timestamptz not null default now());
alter table public.minority_games add column if not exists used_pairs jsonb not null default '[]'::jsonb;
create table if not exists public.minority_rounds (id uuid primary key default gen_random_uuid(), room_id uuid not null references public.minority_games(room_id) on delete cascade, round_no integer not null check (round_no between 1 and 6), majority_word text not null, minority_word text not null, assignments jsonb not null check (jsonb_typeof(assignments) = 'object'), confirmed jsonb not null default '{}'::jsonb check (jsonb_typeof(confirmed) = 'object'), status text not null default 'confirm' check (status in ('confirm','talk','vote','result','ended')), created_at timestamptz not null default now(), unique(room_id, round_no));
create table if not exists public.minority_votes (round_id uuid not null references public.minority_rounds(id) on delete cascade, voter_id uuid not null references public.group_members(id) on delete cascade, target_id uuid not null references public.group_members(id) on delete cascade, created_at timestamptz not null default now(), primary key(round_id, voter_id));
create index if not exists minority_rounds_room_idx on public.minority_rounds(room_id, round_no);
create index if not exists minority_votes_round_idx on public.minority_votes(round_id);
alter table public.minority_games enable row level security; alter table public.minority_rounds enable row level security; alter table public.minority_votes enable row level security;
revoke all on public.minority_games, public.minority_rounds, public.minority_votes from anon, authenticated; grant all on public.minority_games, public.minority_rounds, public.minority_votes to service_role;

create or replace function public.minority_create_room(p_host_user_id uuid, p_invite_hash text, p_host_secret_hash text, p_host_name text, p_expires_at timestamptz, p_pairs jsonb)
returns table(room_id uuid, host_member_id uuid) language plpgsql security definer set search_path=public as $$
declare new_room uuid; new_member uuid; cards jsonb;
begin
 if p_host_user_id is null then raise exception 'OWNER_NULL'; end if;
 if jsonb_typeof(p_pairs)<>'array' or jsonb_array_length(p_pairs)<1 or jsonb_array_length(p_pairs)>200 or exists(select 1 from jsonb_array_elements(p_pairs) pair where jsonb_typeof(pair)<>'object' or nullif(pair->>'majority','') is null or nullif(pair->>'minority','') is null or pair->>'majority'=pair->>'minority') then raise exception 'INVALID_REQUEST'; end if;
 cards := (select jsonb_agg(jsonb_build_object('id','minority:'||((ord-1)::text),'text',pair->>'majority','r18',false,'sourceDeckId','minority_topic','participantRule','group') order by ord) from jsonb_array_elements(p_pairs) with ordinality as x(pair,ord));
 while jsonb_array_length(cards) < 6 loop cards := cards || jsonb_build_array(cards->((jsonb_array_length(cards)-1) % jsonb_array_length(cards))); end loop;
 insert into public.group_rooms(host_user_id,invite_hash,deck_id,deck_name,cards,adult_only,member_count,expires_at,game_type) values(p_host_user_id,p_invite_hash,'minority_topic','ひとりだけ違うお題',cards,false,1,p_expires_at,'minority_topic') returning id into new_room;
 insert into public.group_members(room_id,secret_hash,display_name,role,adult_confirmed) values(new_room,p_host_secret_hash,left(p_host_name,40),'host',true) returning id into new_member;
 insert into public.minority_games(room_id,pairs) values(new_room,p_pairs);
 return query select new_room,new_member;
end; $$;
revoke all on function public.minority_create_room(uuid,text,text,text,timestamptz,jsonb) from public, anon, authenticated; grant execute on function public.minority_create_room(uuid,text,text,text,timestamptz,jsonb) to service_role;

create or replace function public.minority_cast_vote(p_room_id uuid, p_round_no integer, p_voter_id uuid, p_target_id uuid) returns public.minority_votes language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.minority_games; r public.minority_rounds; v public.minority_votes; n integer; total integer;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
 if not found or room.game_type <> 'minority_topic' or room.expires_at <= now() or room.status <> 'playing' then raise exception 'MINORITY_PHASE'; end if;
 select * into game from public.minority_games where room_id=p_room_id for update;
 if not found or game.round_no <> p_round_no or game.phase <> 'vote' then raise exception 'MINORITY_VOTE_CLOSED'; end if;
 select * into r from public.minority_rounds where room_id=p_room_id and round_no=p_round_no for update;
 if not found or r.status <> 'vote' then raise exception 'MINORITY_VOTE_CLOSED'; end if;
 if p_voter_id=p_target_id then raise exception 'MINORITY_SELF_VOTE'; end if;
 if not exists(select 1 from public.group_members where id=p_voter_id and room_id=p_room_id) or not exists(select 1 from public.group_members where id=p_target_id and room_id=p_room_id) or not (r.assignments ? p_voter_id::text) or not (r.assignments ? p_target_id::text) then raise exception 'FORBIDDEN'; end if;
 if exists(select 1 from public.minority_votes where round_id=r.id and voter_id=p_voter_id) then raise exception 'MINORITY_ALREADY_VOTED'; end if;
 insert into public.minority_votes(round_id,voter_id,target_id) values(r.id,p_voter_id,p_target_id) returning * into v;
 select count(*) into n from public.minority_votes where round_id=r.id; select count(*) into total from jsonb_object_keys(r.assignments);
 if n>=total then update public.minority_rounds set status='result' where id=r.id; update public.minority_games set phase='result',updated_at=now() where room_id=p_room_id; end if;
 update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id; return v;
end; $$;
revoke all on function public.minority_cast_vote(uuid,integer,uuid,uuid) from public, anon, authenticated; grant execute on function public.minority_cast_vote(uuid,integer,uuid,uuid) to service_role;

create or replace function public.minority_confirm(p_room_id uuid, p_round_no integer, p_member_id uuid) returns public.minority_rounds language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.minority_games; r public.minority_rounds; m public.group_members; c jsonb; total integer;
begin
 select * into room from public.group_rooms where id=p_room_id for update; if not found or room.game_type<>'minority_topic' or room.expires_at<=now() or room.status<>'playing' then raise exception 'MINORITY_PHASE'; end if;
 select * into game from public.minority_games where room_id=p_room_id for update; if not found or game.round_no<>p_round_no then raise exception 'MINORITY_STALE_ROUND'; end if;
 select * into r from public.minority_rounds where room_id=p_room_id and round_no=p_round_no for update; select * into m from public.group_members where id=p_member_id and room_id=p_room_id;
 if not found or r.status<>'confirm' or not (r.assignments ? p_member_id::text) then raise exception 'MINORITY_PHASE'; end if;
 if r.confirmed ? p_member_id::text then return r; end if;
 c:=r.confirmed || jsonb_build_object(p_member_id::text,true); select count(*) into total from jsonb_object_keys(r.assignments);
 update public.minority_rounds set confirmed=c,status=case when (select count(*) from jsonb_object_keys(c))>=total then 'talk' else status end where id=r.id returning * into r;
 update public.minority_games set phase=r.status,updated_at=now() where room_id=p_room_id; update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id; return r;
end; $$;
revoke all on function public.minority_confirm(uuid,integer,uuid) from public, anon, authenticated; grant execute on function public.minority_confirm(uuid,integer,uuid) to service_role;

create or replace function public.minority_set_phase(p_room_id uuid, p_round_no integer, p_member_id uuid, p_phase text, p_expected_revision bigint) returns public.minority_rounds language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.minority_games; r public.minority_rounds; m public.group_members;
begin
 select * into room from public.group_rooms where id=p_room_id for update; if not found or room.game_type<>'minority_topic' or room.expires_at<=now() or room.revision<>p_expected_revision then raise exception 'GROUP_STALE'; end if;
 select * into game from public.minority_games where room_id=p_room_id for update; select * into m from public.group_members where id=p_member_id and room_id=p_room_id and role='host';
 if not found or p_phase<>'vote' then raise exception 'FORBIDDEN'; end if;
 select * into r from public.minority_rounds where room_id=p_room_id and round_no=p_round_no for update; if not found or game.round_no<>p_round_no or r.status<>'talk' then raise exception 'MINORITY_PHASE'; end if;
 update public.minority_rounds set status='vote' where id=r.id returning * into r; update public.minority_games set phase='vote',updated_at=now() where room_id=p_room_id; update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id; return r;
end; $$;
revoke all on function public.minority_set_phase(uuid,integer,uuid,text,bigint) from public, anon, authenticated; grant execute on function public.minority_set_phase(uuid,integer,uuid,text,bigint) to service_role;

create or replace function public.minority_start_round(p_room_id uuid, p_round_no integer, p_majority text, p_minority text, p_assignments jsonb, p_used_pairs jsonb, p_expected_revision bigint) returns public.minority_rounds language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.minority_games; previous public.minority_rounds; r public.minority_rounds; member_count integer; minority_count integer;
begin
 select * into room from public.group_rooms where id=p_room_id for update; select * into game from public.minority_games where room_id=p_room_id for update;
 if not found or room.game_type<>'minority_topic' or room.expires_at<=now() or room.revision<>p_expected_revision then raise exception 'GROUP_STALE'; end if;
 if p_round_no<1 or p_round_no>6 or p_majority=p_minority or game.round_no<>p_round_no-1 or (p_round_no=1 and room.status<>'lobby') or (p_round_no>1 and (room.status<>'playing' or game.phase<>'result')) then raise exception 'MINORITY_PHASE'; end if;
 if p_round_no>1 then select * into previous from public.minority_rounds where room_id=p_room_id and round_no=p_round_no-1 for update; if not found or previous.status<>'result' then raise exception 'MINORITY_PHASE'; end if; end if;
 select count(*) into member_count from public.group_members where room_id=p_room_id; select count(*) into minority_count from jsonb_each(p_assignments) where value->>'role'='minority';
 if member_count<3 or member_count>8 or jsonb_typeof(p_assignments)<>'object' or (select count(*) from jsonb_object_keys(p_assignments))<>member_count or minority_count<>1 or exists(select 1 from public.group_members where room_id=p_room_id and not (p_assignments ? id::text)) or exists(select 1 from jsonb_each(p_assignments) where value->>'word' not in (p_majority,p_minority)) then raise exception 'GROUP_PARTICIPANTS'; end if;
 if jsonb_typeof(p_used_pairs)<>'array' or jsonb_array_length(p_used_pairs)<>p_round_no or (select count(*) from jsonb_array_elements_text(p_used_pairs))<>p_round_no or exists(select 1 from jsonb_array_elements_text(p_used_pairs) a where (select count(*) from jsonb_array_elements_text(p_used_pairs) b where b=a)>1) or exists(select 1 from jsonb_array_elements_text(p_used_pairs) a where (a::integer)<0 or (a::integer)>=jsonb_array_length(game.pairs)) or exists(select 1 from generate_series(0,p_round_no-2) i where p_used_pairs->i <> game.used_pairs->i) then raise exception 'MINORITY_PAIRS_INVALID'; end if;
 insert into public.minority_rounds(room_id,round_no,majority_word,minority_word,assignments,status) values(p_room_id,p_round_no,p_majority,p_minority,p_assignments,'confirm') returning * into r;
 update public.minority_games set round_no=p_round_no,phase='confirm',used_pairs=p_used_pairs,updated_at=now() where room_id=p_room_id; update public.group_rooms set status='playing',revision=revision+1,updated_at=now() where id=p_room_id; return r;
end; $$;
revoke all on function public.minority_start_round(uuid,integer,text,text,jsonb,jsonb,bigint) from public, anon, authenticated; grant execute on function public.minority_start_round(uuid,integer,text,text,jsonb,jsonb,bigint) to service_role;

create or replace function public.minority_finish(p_room_id uuid, p_round_no integer, p_member_id uuid, p_expected_revision bigint) returns void language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.minority_games; m public.group_members;
begin
 select * into room from public.group_rooms where id=p_room_id for update;
 if not found or room.game_type<>'minority_topic' or room.expires_at<=now() or room.revision<>p_expected_revision then raise exception 'GROUP_STALE'; end if;
 select * into game from public.minority_games where room_id=p_room_id for update;
 if not found then raise exception 'MINORITY_UNAVAILABLE'; end if;
 select * into m from public.group_members where id=p_member_id and room_id=p_room_id and role='host';
 if not found or game.phase='ended' or p_round_no<>game.round_no then raise exception 'GROUP_STALE'; end if;
 delete from public.minority_rounds where room_id=p_room_id; update public.minority_games set phase='ended',updated_at=now() where room_id=p_room_id; update public.group_rooms set status='ended',revision=revision+1,updated_at=now() where id=p_room_id;
end; $$;
revoke all on function public.minority_finish(uuid,integer,uuid,bigint) from public, anon, authenticated; grant execute on function public.minority_finish(uuid,integer,uuid,bigint) to service_role;
commit;
