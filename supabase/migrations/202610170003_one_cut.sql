-- 「ワンカット」(game_type='one_cut', group play only, basic form: one actor per take).
-- Depends on 202610170001_group_game_types.sql, which already allows 'one_cut' in the
-- group_rooms.game_type CHECK. This migration deliberately does not touch that constraint.
-- Later phases (F1 start, ensemble) add their own 2026101800xx migrations; `mode` / `start_style` /
-- `assignments` / `guesses` exist from the start so those do not need column additions.
--
-- Secrecy model: every table is service_role only and every transition is a security-definer RPC.
-- one_cut_takes.answer_index (the scene the actor performs) is read back by the API only for the actor
-- during brief / take / vote, and for everyone at result. Votes are never returned per voter.
-- Retention (PO decision 2026-10-09): both ways into the end of the game (one_cut_finish and the last one_cut_close_break) go
-- through one_cut_finalize, which deletes the whole one_cut_games row (scenes, takes, votes, likes, scores, awards) at once.
-- Only the closing screen's data -- everyone's total and the lap awards (PO decision Q14: all totals are shown) -- is copied into
-- one_cut_results for 5 minutes, so every device can still show it; it is then deleted (lazily by one_cut_state and by the group
-- cleanup). A game finished from the lobby keeps nothing.
begin;

create table if not exists public.one_cut_games (
  room_id uuid primary key references public.group_rooms(id) on delete cascade,
  scenes jsonb not null check (jsonb_typeof(scenes) = 'array' and jsonb_array_length(scenes) between 6 and 400),
  mode text not null default 'solo_actor' check (mode in ('solo_actor','ensemble')),
  start_style text not null default 'slate' check (start_style in ('slate','f1','random')),
  laps_total integer not null default 2 check (laps_total between 1 and 3),
  -- true until start: the lap count is then derived from the player count (2..4 players -> 2 laps, 5..8 -> 1 lap)
  laps_auto boolean not null default false,
  lap_no integer not null default 0 check (lap_no between 0 and 3),
  take_no integer not null default 0 check (take_no between 0 and 24),
  phase text not null default 'lobby' check (phase in ('lobby','brief','take','vote','result','break')),
  used_answer_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(used_answer_ids) = 'array'),
  used_option_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(used_option_ids) = 'array'),
  scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
  awards jsonb not null default '[]'::jsonb check (jsonb_typeof(awards) = 'array'),
  updated_at timestamptz not null default now(),
  constraint one_cut_games_size check (octet_length(scenes::text) <= 262144 and octet_length(awards::text) <= 8192)
);

-- The only thing that outlives a finished game, and only until result_expires_at (end of game + 5 minutes).
-- result = {scores: {member id: points}, awards: [{lap, memberIds}]}.
create table if not exists public.one_cut_results (
  room_id uuid primary key references public.group_rooms(id) on delete cascade,
  result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 8192),
  result_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists one_cut_results_expiry_idx on public.one_cut_results(result_expires_at);

create table if not exists public.one_cut_takes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.one_cut_games(room_id) on delete cascade,
  take_no integer not null check (take_no between 1 and 24),
  lap_no integer not null check (lap_no between 1 and 3),
  actor_member_id uuid references public.group_members(id) on delete cascade, -- ensemble: null
  options jsonb not null check (jsonb_typeof(options) = 'array' and octet_length(options::text) <= 4096), -- [scene_id x 6]
  option_texts jsonb not null check (jsonb_typeof(option_texts) = 'array' and octet_length(option_texts::text) <= 4096), -- texts copied from the scenes snapshot
  answer_index smallint check (answer_index between 0 and 7), -- solo_actor answer; never returned before result (except to the actor)
  assignments jsonb check (assignments is null or (jsonb_typeof(assignments) = 'object' and octet_length(assignments::text) <= 4096)),
  start_style text not null default 'slate' check (start_style in ('slate','f1')),
  take_started_at timestamptz,
  action_at timestamptz,
  cut_at timestamptz,
  vote_deadline timestamptz,
  status text not null default 'brief' check (status in ('brief','take','vote','result','skipped')),
  created_at timestamptz not null default now(),
  unique (room_id, take_no)
);

create table if not exists public.one_cut_votes (
  take_id uuid not null references public.one_cut_takes(id) on delete cascade,
  voter_id uuid not null references public.group_members(id) on delete cascade,
  choice smallint check (choice between 0 and 7), -- null = わからない
  guesses jsonb, -- ensemble
  created_at timestamptz not null default now(),
  primary key (take_id, voter_id)
);

create table if not exists public.one_cut_likes (
  room_id uuid not null references public.one_cut_games(room_id) on delete cascade,
  lap_no integer not null check (lap_no between 1 and 3),
  voter_id uuid not null references public.group_members(id) on delete cascade,
  target_id uuid not null references public.group_members(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (room_id, lap_no, voter_id),
  check (voter_id <> target_id)
);

create index if not exists one_cut_takes_room_idx on public.one_cut_takes(room_id, take_no);
create index if not exists one_cut_votes_take_idx on public.one_cut_votes(take_id);

alter table public.one_cut_games enable row level security;
alter table public.one_cut_takes enable row level security;
alter table public.one_cut_votes enable row level security;
alter table public.one_cut_likes enable row level security;
alter table public.one_cut_results enable row level security;
revoke all on public.one_cut_games, public.one_cut_takes, public.one_cut_votes, public.one_cut_likes, public.one_cut_results from anon, authenticated;
grant all on public.one_cut_games, public.one_cut_takes, public.one_cut_votes, public.one_cut_likes, public.one_cut_results to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by any API role; used only inside the RPCs below)
-- ---------------------------------------------------------------------------

-- Room order: host first, then join order. Take k is played by element ((k-1) % n) + 1.
create or replace function public.one_cut_member_order(p_room_id uuid)
returns uuid[] language sql stable set search_path = public as $$
  select coalesce(array_agg(id order by (role = 'host') desc, joined_at, id), '{}'::uuid[]) from public.group_members where room_id = p_room_id;
$$;

-- The actor of the take, or the host acting for them.
create or replace function public.one_cut_actor_ok(p_room_id uuid, p_member_id uuid, p_actor_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and (id = p_actor_id or role = 'host'));
$$;

-- Ends the game's data: copies the closing screen's data (scores + awards) into one_cut_results (5 minutes) and deletes the whole
-- game row, which cascades takes (and their votes) and likes. A game that never left the lobby keeps no result.
-- The single place both ways to the end (one_cut_finish and the last one_cut_close_break) go through.
create or replace function public.one_cut_finalize(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game public.one_cut_games;
begin
  select * into v_game from public.one_cut_games where room_id = p_room_id;
  if not found then return; end if;
  if v_game.phase <> 'lobby' then
    insert into public.one_cut_results(room_id, result, result_expires_at)
      values (p_room_id, jsonb_build_object('scores', v_game.scores, 'awards', v_game.awards), now() + interval '5 minutes')
      on conflict (room_id) do update set result = excluded.result, result_expires_at = excluded.result_expires_at;
  end if;
  delete from public.one_cut_games where room_id = p_room_id;
end;
$$;

-- Lap award winners: everyone tied for the most likes (empty when nobody was liked).
create or replace function public.one_cut_award_winners(p_room_id uuid, p_lap_no integer)
returns jsonb language sql stable set search_path = public as $$
  with counted as (
    select target_id, count(*) as likes from public.one_cut_likes where room_id = p_room_id and lap_no = p_lap_no group by target_id
  )
  select coalesce(jsonb_agg(target_id::text order by target_id), '[]'::jsonb) from counted where likes = (select max(likes) from counted);
$$;

-- Validates and inserts the take described by p_take ({takeNo, lapNo, actorId, options, answerIndex, startStyle}) and moves the
-- game to 'brief'. The caller holds the room and game row locks. The actor must follow the room order; options must be 6 distinct
-- ids from the scenes snapshot; the answer must not have been an answer before. Expression / category rules are the server's job.
create or replace function public.one_cut_insert_take(p_room_id uuid, p_take jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game public.one_cut_games;
  v_order uuid[];
  v_n integer;
  v_take_no integer;
  v_lap_no integer;
  v_actor uuid;
  v_answer integer;
  v_options jsonb;
  v_texts jsonb;
  v_answer_id text;
  v_style text;
begin
  select * into v_game from public.one_cut_games where room_id = p_room_id;
  if not found or p_take is null or jsonb_typeof(p_take) is distinct from 'object' then raise exception 'ONE_CUT_INVALID'; end if;
  if coalesce(p_take ->> 'takeNo', '') !~ '^[0-9]{1,3}$' or coalesce(p_take ->> 'lapNo', '') !~ '^[0-9]$'
     or coalesce(p_take ->> 'answerIndex', '') !~ '^[0-9]$' or coalesce(p_take ->> 'actorId', '') !~* '^[0-9a-f-]{36}$' then raise exception 'ONE_CUT_INVALID'; end if;
  v_take_no := (p_take ->> 'takeNo')::integer;
  v_lap_no := (p_take ->> 'lapNo')::integer;
  v_answer := (p_take ->> 'answerIndex')::integer;
  v_actor := (p_take ->> 'actorId')::uuid;
  v_options := p_take -> 'options';
  v_style := coalesce(p_take ->> 'startStyle', 'slate');
  if v_style <> 'slate' or v_game.mode <> 'solo_actor' then raise exception 'ONE_CUT_INVALID'; end if;
  if v_take_no <> v_game.take_no + 1 then raise exception 'ONE_CUT_STALE_TAKE'; end if;
  v_order := public.one_cut_member_order(p_room_id);
  v_n := coalesce(array_length(v_order, 1), 0);
  if v_n < 2 or v_n > 8 then raise exception 'ONE_CUT_PARTICIPANTS'; end if;
  if v_take_no > v_game.laps_total * v_n then raise exception 'ONE_CUT_PHASE'; end if;
  if v_lap_no <> (v_take_no - 1) / v_n + 1 or v_order[((v_take_no - 1) % v_n) + 1] is distinct from v_actor then raise exception 'ONE_CUT_INVALID'; end if;
  if jsonb_typeof(v_options) is distinct from 'array' or jsonb_array_length(v_options) <> 6
     or exists (select 1 from jsonb_array_elements(v_options) o where jsonb_typeof(o) is distinct from 'string')
     or (select count(distinct o) from jsonb_array_elements_text(v_options) o) <> 6
     or v_answer > 5 then raise exception 'ONE_CUT_INVALID'; end if;
  select jsonb_agg(s.value ->> 'text' order by o.ord) into v_texts
    from jsonb_array_elements_text(v_options) with ordinality o(id, ord)
    join lateral (select x as value from jsonb_array_elements(v_game.scenes) x where x ->> 'id' = o.id limit 1) s on true;
  if v_texts is null or jsonb_array_length(v_texts) <> 6 then raise exception 'ONE_CUT_INVALID'; end if;
  v_answer_id := v_options ->> v_answer;
  if v_game.used_answer_ids ? v_answer_id then raise exception 'ONE_CUT_INVALID'; end if;
  insert into public.one_cut_takes(room_id, take_no, lap_no, actor_member_id, options, option_texts, answer_index, start_style, status)
    values (p_room_id, v_take_no, v_lap_no, v_actor, v_options, v_texts, v_answer, 'slate', 'brief');
  update public.one_cut_games set
    take_no = v_take_no,
    lap_no = v_lap_no,
    phase = 'brief',
    used_answer_ids = v_game.used_answer_ids || to_jsonb(v_answer_id),
    used_option_ids = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(v_game.used_option_ids || v_options) x),
    updated_at = now()
  where room_id = p_room_id;
end;
$$;

-- Scores the take (voters who guessed the answer +1, the actor +number of correct voters), then result.
-- The caller holds the room and game locks.
create or replace function public.one_cut_score_take(p_room_id uuid, p_take_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game public.one_cut_games;
  v_take public.one_cut_takes;
  v_correct integer;
begin
  select * into v_game from public.one_cut_games where room_id = p_room_id;
  select * into v_take from public.one_cut_takes where id = p_take_id;
  select count(*) into v_correct from public.one_cut_votes where take_id = v_take.id and choice is not null and choice = v_take.answer_index and voter_id <> v_take.actor_member_id;
  update public.one_cut_games set
    phase = 'result',
    scores = coalesce((select jsonb_object_agg(s.key,
        (s.value #>> '{}')::integer
        + case when exists (select 1 from public.one_cut_votes v where v.take_id = v_take.id and v.voter_id::text = s.key and v.choice = v_take.answer_index and v.voter_id <> v_take.actor_member_id) then 1 else 0 end
        + case when s.key = v_take.actor_member_id::text then v_correct else 0 end)
      from jsonb_each(v_game.scores) s), v_game.scores),
    updated_at = now()
  where room_id = p_room_id;
  update public.one_cut_takes set status = 'result' where id = v_take.id;
end;
$$;

revoke all on function public.one_cut_member_order(uuid) from public, anon, authenticated, service_role;
revoke all on function public.one_cut_actor_ok(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.one_cut_finalize(uuid) from public, anon, authenticated, service_role;
revoke all on function public.one_cut_award_winners(uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.one_cut_insert_take(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.one_cut_score_take(uuid,uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create: room + host member + game in one transaction. p_laps_total null = decide at start from the player count.
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_create_room(p_host_user_id uuid, p_invite_hash text, p_host_secret_hash text, p_host_name text, p_expires_at timestamptz, p_scenes jsonb, p_laps_total integer, p_start_style text, p_mode text)
returns table(room_id uuid, host_member_id uuid) language plpgsql security definer set search_path = public as $$
declare
  v_room uuid;
  v_member uuid;
  v_cards jsonb;
begin
  if p_host_user_id is null or p_scenes is null or jsonb_typeof(p_scenes) is distinct from 'array'
     or jsonb_array_length(p_scenes) not between 6 and 400 or octet_length(p_scenes::text) > 262144
     or (p_laps_total is not null and p_laps_total not between 1 and 3)
     or coalesce(p_start_style, 'slate') <> 'slate' or coalesce(p_mode, 'solo_actor') <> 'solo_actor'
     or exists (select 1 from jsonb_array_elements(p_scenes) x
                where jsonb_typeof(x) is distinct from 'object'
                   or jsonb_typeof(x -> 'id') is distinct from 'string' or jsonb_typeof(x -> 'text') is distinct from 'string'
                   or jsonb_typeof(x -> 'category') is distinct from 'string' or jsonb_typeof(x -> 'expression') is distinct from 'string'
                   or (x ? 'similarGroup' and jsonb_typeof(x -> 'similarGroup') not in ('string', 'null'))
                   or nullif(x ->> 'text', '') is null or length(x ->> 'text') > 64 or length(x ->> 'id') > 64 or (x ->> 'id') !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
     or (select count(distinct x ->> 'id') from jsonb_array_elements(p_scenes) x) <> jsonb_array_length(p_scenes) then
    raise exception 'ONE_CUT_INVALID';
  end if;
  -- group_rooms.cards must hold 6..40 entries: the first 40 scenes, in the shape the other group games use
  v_cards := (select jsonb_agg(jsonb_build_object('id', 'one-cut:' || (c ->> 'id'), 'text', c ->> 'text', 'r18', false, 'sourceDeckId', 'one_cut', 'participantRule', 'group') order by ord)
              from jsonb_array_elements(p_scenes) with ordinality x(c, ord) where ord <= 40);
  insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only, member_count, expires_at, game_type)
    values (p_host_user_id, p_invite_hash, 'one_cut', 'ワンカット', v_cards, false, 1, p_expires_at, 'one_cut') returning id into v_room;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed)
    values (v_room, p_host_secret_hash, left(p_host_name, 40), 'host', true) returning id into v_member;
  insert into public.one_cut_games(room_id, scenes, mode, start_style, laps_total, laps_auto)
    values (v_room, p_scenes, 'solo_actor', 'slate', coalesce(p_laps_total, 2), p_laps_total is null);
  return query select v_room, v_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_take: creates a take and enters 'brief'. Two entrances:
--   lobby  (start, host, revision required): fixes the lap count, zeroes the scores, room -> playing
--   result (next, actor or host, no revision): p_take_no must be the next number, so a double press fails with ONE_CUT_STALE_TAKE
-- The actor must follow the room order (checked here again, not only by the server).
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_start_take(p_room_id uuid, p_member_id uuid, p_take_no integer, p_lap_no integer, p_actor_id uuid, p_options jsonb, p_answer_index integer, p_assignments jsonb, p_start_style text, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_prev uuid;
  v_n integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status not in ('lobby', 'playing') then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found then raise exception 'ONE_CUT_UNAVAILABLE'; end if;
  if p_take_no is distinct from v_game.take_no + 1 then raise exception 'ONE_CUT_STALE_TAKE'; end if;
  if p_assignments is not null and jsonb_typeof(p_assignments) <> 'null' then raise exception 'ONE_CUT_INVALID'; end if;
  select count(*) into v_n from public.group_members where room_id = p_room_id;
  if v_game.phase = 'lobby' then
    if v_room.status <> 'lobby' then raise exception 'ONE_CUT_PHASE'; end if;
    if p_expected_revision is null or v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
    if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
    if v_n < 2 or v_n > 8 then raise exception 'ONE_CUT_PARTICIPANTS'; end if;
    update public.one_cut_games set
      laps_total = case when laps_auto then (case when v_n <= 4 then 2 else 1 end) else laps_total end,
      laps_auto = false,
      scores = (select jsonb_object_agg(gm.id::text, 0) from public.group_members gm where gm.room_id = p_room_id),
      updated_at = now()
    where room_id = p_room_id;
    update public.group_rooms set status = 'playing' where id = p_room_id;
  elsif v_game.phase = 'result' then
    if v_room.status <> 'playing' then raise exception 'ONE_CUT_PHASE'; end if;
    select actor_member_id into v_prev from public.one_cut_takes where room_id = p_room_id and take_no = v_game.take_no;
    if not public.one_cut_actor_ok(p_room_id, p_member_id, v_prev) then raise exception 'ONE_CUT_NOT_ACTOR'; end if;
    if v_game.take_no % v_n = 0 then raise exception 'ONE_CUT_PHASE'; end if; -- the last take of a lap goes to the break
  else
    raise exception 'ONE_CUT_PHASE';
  end if;
  perform public.one_cut_insert_take(p_room_id, jsonb_build_object('takeNo', p_take_no, 'lapNo', p_lap_no, 'actorId', p_actor_id, 'options', p_options, 'answerIndex', p_answer_index, 'startStyle', coalesce(p_start_style, 'slate')));
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- result -> break after the last take of a lap (actor or host).
create or replace function public.one_cut_to_break(p_room_id uuid, p_take_no integer, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_take public.one_cut_takes;
  v_n integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found or v_game.take_no <> p_take_no then raise exception 'ONE_CUT_STALE_TAKE'; end if;
  if v_game.phase <> 'result' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_take from public.one_cut_takes where room_id = p_room_id and take_no = p_take_no;
  if not public.one_cut_actor_ok(p_room_id, p_member_id, v_take.actor_member_id) then raise exception 'ONE_CUT_NOT_ACTOR'; end if;
  select count(*) into v_n from public.group_members where room_id = p_room_id;
  if p_take_no % v_n <> 0 then raise exception 'ONE_CUT_PHASE'; end if;
  update public.one_cut_games set phase = 'break', updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- ready: brief -> take (actor or host). The server supplies p_started_at (its clock + 1s) so every
-- instant of the shoot is on the same clock as the serverNow the clients sync against. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_ready(p_room_id uuid, p_take_no integer, p_member_id uuid, p_started_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_take public.one_cut_takes;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found or v_game.take_no <> p_take_no then raise exception 'ONE_CUT_STALE_TAKE'; end if;
  select * into v_take from public.one_cut_takes where room_id = p_room_id and take_no = p_take_no for update;
  if not found then raise exception 'ONE_CUT_PHASE'; end if;
  if not public.one_cut_actor_ok(p_room_id, p_member_id, v_take.actor_member_id) then raise exception 'ONE_CUT_NOT_ACTOR'; end if;
  if v_game.phase in ('take', 'vote', 'result') then return; end if;
  if v_game.phase <> 'brief' or v_take.status <> 'brief' then raise exception 'ONE_CUT_PHASE'; end if;
  -- the API server's clock may drift from this database's; a start instant too far off is replaced rather than refused
  if p_started_at is null or p_started_at < now() - interval '15 seconds' or p_started_at > now() + interval '15 seconds' then p_started_at := now() + interval '1 second'; end if;
  update public.one_cut_takes set
    status = 'take',
    take_started_at = p_started_at,
    action_at = p_started_at + interval '5.5 seconds',
    cut_at = p_started_at + interval '8.5 seconds',
    vote_deadline = p_started_at + interval '48.5 seconds'
  where id = v_take.id;
  update public.one_cut_games set phase = 'take', updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- expire: the lazy transition, called whenever state is read. take -> vote half a second after the cut,
-- vote -> result (scored) at the vote deadline. Does nothing unless a deadline has passed.
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_expire(p_room_id uuid, p_take_no integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_take public.one_cut_takes;
  v_changed boolean := false;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status <> 'playing' then return; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found or v_game.take_no <> p_take_no or v_game.phase not in ('take', 'vote') then return; end if;
  select * into v_take from public.one_cut_takes where room_id = p_room_id and take_no = p_take_no for update;
  if not found then return; end if;
  if v_game.phase = 'take' and v_take.cut_at is not null and now() >= v_take.cut_at + interval '0.5 seconds' then
    update public.one_cut_takes set status = 'vote' where id = v_take.id;
    update public.one_cut_games set phase = 'vote', updated_at = now() where room_id = p_room_id;
    v_game.phase := 'vote';
    v_changed := true;
  end if;
  if v_game.phase = 'vote' and v_take.vote_deadline is not null and now() >= v_take.vote_deadline then
    perform public.one_cut_score_take(p_room_id, v_take.id);
    v_changed := true;
  end if;
  if v_changed then update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- cast_vote: a non-actor picks A..F (0..5) or passes (null). One vote, no changes, no revision.
-- When everyone but the actor has voted the take is scored and moves to result.
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_cast_vote(p_room_id uuid, p_take_no integer, p_voter_id uuid, p_choice integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_take public.one_cut_takes;
  v_votes integer;
  v_voters integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found or v_game.take_no <> p_take_no then raise exception 'ONE_CUT_STALE_TAKE'; end if;
  if v_game.phase <> 'vote' then raise exception 'ONE_CUT_VOTE_CLOSED'; end if;
  select * into v_take from public.one_cut_takes where room_id = p_room_id and take_no = p_take_no for update;
  if not found or v_take.status <> 'vote' or (v_take.vote_deadline is not null and now() >= v_take.vote_deadline) then raise exception 'ONE_CUT_VOTE_CLOSED'; end if;
  if p_choice is not null and p_choice not between 0 and jsonb_array_length(v_take.options) - 1 then raise exception 'ONE_CUT_INVALID'; end if;
  if not exists (select 1 from public.group_members where id = p_voter_id and room_id = p_room_id) then raise exception 'FORBIDDEN'; end if;
  if p_voter_id = v_take.actor_member_id then raise exception 'ONE_CUT_ACTOR_VOTE'; end if;
  if exists (select 1 from public.one_cut_votes where take_id = v_take.id and voter_id = p_voter_id) then raise exception 'ONE_CUT_ALREADY_VOTED'; end if;
  insert into public.one_cut_votes(take_id, voter_id, choice) values (v_take.id, p_voter_id, p_choice);
  select count(*) into v_votes from public.one_cut_votes where take_id = v_take.id;
  select count(*) - 1 into v_voters from public.group_members where room_id = p_room_id;
  if v_votes >= v_voters then perform public.one_cut_score_take(p_room_id, v_take.id); end if;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- close_vote: the host ends voting early. vote -> result (scored).
create or replace function public.one_cut_close_vote(p_room_id uuid, p_take_no integer, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_take public.one_cut_takes;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found or v_game.take_no <> p_take_no then raise exception 'ONE_CUT_STALE_TAKE'; end if;
  if v_game.phase <> 'vote' then raise exception 'ONE_CUT_VOTE_CLOSED'; end if;
  select * into v_take from public.one_cut_takes where room_id = p_room_id and take_no = p_take_no for update;
  if not found or v_take.status <> 'vote' then raise exception 'ONE_CUT_VOTE_CLOSED'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
  perform public.one_cut_score_take(p_room_id, v_take.id);
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- skip: the actor (or host for them) passes a take in 'brief'. ONE transaction: the take becomes 'skipped', its answer is
-- released from used_answer_ids, then either the next take is created (p_next, validated exactly like start_take) or, after the
-- last take of a lap (p_next null), the game goes to 'break'. Any failure rolls back the skip too.
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_skip(p_room_id uuid, p_take_no integer, p_member_id uuid, p_next jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_take public.one_cut_takes;
  v_n integer;
  v_answer_id text;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found or v_game.take_no <> p_take_no then raise exception 'ONE_CUT_STALE_TAKE'; end if;
  if v_game.phase <> 'brief' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_take from public.one_cut_takes where room_id = p_room_id and take_no = p_take_no for update;
  if not found or v_take.status <> 'brief' then raise exception 'ONE_CUT_PHASE'; end if;
  if not public.one_cut_actor_ok(p_room_id, p_member_id, v_take.actor_member_id) then raise exception 'ONE_CUT_NOT_ACTOR'; end if;
  select count(*) into v_n from public.group_members where room_id = p_room_id;
  v_answer_id := v_take.options ->> v_take.answer_index;
  update public.one_cut_takes set status = 'skipped' where id = v_take.id;
  update public.one_cut_games set
    used_answer_ids = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(v_game.used_answer_ids) x where x <> v_answer_id),
    updated_at = now()
  where room_id = p_room_id;
  if p_next is null or jsonb_typeof(p_next) = 'null' then
    if p_take_no % v_n <> 0 then raise exception 'ONE_CUT_INVALID'; end if;
    update public.one_cut_games set phase = 'break', updated_at = now() where room_id = p_room_id;
  else
    if p_take_no % v_n = 0 then raise exception 'ONE_CUT_INVALID'; end if; -- the last take of a lap has no next take in the same lap
    perform public.one_cut_insert_take(p_room_id, p_next);
  end if;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- like: 主演賞 for the lap in the break. Any member, once per lap, never themselves, only someone who performed that lap;
-- re-sending replaces the earlier choice. Not offered with fewer than 3 players.
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_like(p_room_id uuid, p_lap_no integer, p_voter_id uuid, p_target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_n integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found then raise exception 'ONE_CUT_UNAVAILABLE'; end if;
  if v_game.phase <> 'break' or v_game.lap_no <> p_lap_no then raise exception 'ONE_CUT_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_voter_id and room_id = p_room_id)
     or not exists (select 1 from public.group_members where id = p_target_id and room_id = p_room_id) then raise exception 'FORBIDDEN'; end if;
  if p_voter_id = p_target_id then raise exception 'ONE_CUT_INVALID'; end if;
  select count(*) into v_n from public.group_members where room_id = p_room_id;
  if v_n < 3 then raise exception 'ONE_CUT_PHASE'; end if;
  if not exists (select 1 from public.one_cut_takes where room_id = p_room_id and lap_no = p_lap_no and actor_member_id = p_target_id and status = 'result') then raise exception 'ONE_CUT_INVALID'; end if;
  insert into public.one_cut_likes(room_id, lap_no, voter_id, target_id) values (p_room_id, p_lap_no, p_voter_id, p_target_id)
    on conflict (room_id, lap_no, voter_id) do update set target_id = excluded.target_id, updated_at = now();
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- close_break: the host leaves the break. Tallies the lap's likes into awards (only with 3+ players and at least one like),
-- then either starts the next lap with p_next, or -- after the last lap (p_next null) -- ends the game: one_cut_finalize, room ended.
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_close_break(p_room_id uuid, p_lap_no integer, p_member_id uuid, p_next jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_n integer;
  v_winners jsonb;
  v_last boolean;
  v_has_next boolean := p_next is not null and jsonb_typeof(p_next) <> 'null';
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'break' or v_game.lap_no <> p_lap_no then raise exception 'ONE_CUT_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
  v_last := v_game.lap_no >= v_game.laps_total;
  if v_last = v_has_next then raise exception 'ONE_CUT_INVALID'; end if;
  select count(*) into v_n from public.group_members where room_id = p_room_id;
  v_winners := case when v_n >= 3 then public.one_cut_award_winners(p_room_id, p_lap_no) else '[]'::jsonb end;
  if jsonb_array_length(v_winners) > 0 then
    update public.one_cut_games set awards = awards || jsonb_build_array(jsonb_build_object('lap', p_lap_no, 'memberIds', v_winners)), updated_at = now() where room_id = p_room_id;
  end if;
  if v_last then
    perform public.one_cut_finalize(p_room_id);
    update public.group_rooms set status = 'ended', revealed = false, revision = revision + 1, updated_at = now() where id = p_room_id;
  else
    perform public.one_cut_insert_take(p_room_id, p_next);
    update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- finish: the host ends the game from any phase. In the break the lap's award is tallied first. The game is then finalized
-- (everything deleted; only the scores and awards survive for 5 minutes in one_cut_results, unless the game never started).
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_finish(p_room_id uuid, p_member_id uuid, p_take_no integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_n integer;
  v_winners jsonb;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'one_cut' or v_room.expires_at <= now() or v_room.status not in ('lobby', 'playing') then raise exception 'ONE_CUT_PHASE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id for update;
  if not found then raise exception 'ONE_CUT_UNAVAILABLE'; end if;
  if p_take_no is distinct from v_game.take_no then raise exception 'ONE_CUT_STALE_TAKE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
  if v_game.phase = 'break' then
    select count(*) into v_n from public.group_members where room_id = p_room_id;
    v_winners := case when v_n >= 3 then public.one_cut_award_winners(p_room_id, v_game.lap_no) else '[]'::jsonb end;
    if jsonb_array_length(v_winners) > 0 then
      update public.one_cut_games set awards = awards || jsonb_build_array(jsonb_build_object('lap', v_game.lap_no, 'memberIds', v_winners)) where room_id = p_room_id;
    end if;
  end if;
  perform public.one_cut_finalize(p_room_id);
  update public.group_rooms set status = 'ended', revealed = false, revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- state: ONE consistent snapshot for the API, already filtered for p_member_id. A due deadline is settled first
-- (one_cut_expire, on the database clock). Otherwise the room row is share-locked, which every mutating RPC contends on,
-- so the reads below cannot interleave with a transition. Secrecy lives here:
--   answerIndex   only at result (everyone)        myAnswerIndex only for the actor of the take, during brief / take / vote
--   votes         only at result, as {voter_id, choice} for scoring (the API returns just tallies and the correct voters)
--   votedCount / memberHasVoted are a count and the caller's own flag; no vote is ever listed before result
-- Once the game is over (no game row) it returns phase 'final' with scores + awards for 5 minutes, then phase 'ended'.
-- ---------------------------------------------------------------------------
create or replace function public.one_cut_state(p_room_id uuid, p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.one_cut_games;
  v_take public.one_cut_takes;
  v_has_take boolean := false;
  v_voted integer := 0;
  v_has_voted boolean := false;
  v_my_answer integer;
  v_answer integer;
  v_votes jsonb := '[]'::jsonb;
  v_lap_takes jsonb := '[]'::jsonb;
  v_my_like uuid;
  v_liked integer := 0;
  v_due boolean := false;
  v_result public.one_cut_results;
begin
  select * into v_room from public.group_rooms where id = p_room_id;
  if not found or v_room.game_type <> 'one_cut' then raise exception 'ONE_CUT_UNAVAILABLE'; end if;
  select * into v_game from public.one_cut_games where room_id = p_room_id;
  if not found then
    -- the game is over: its data is gone. For 5 minutes the closing screen's data (scores + awards) is still served, then nothing.
    delete from public.one_cut_results where room_id = p_room_id and result_expires_at <= now();
    select * into v_result from public.one_cut_results where room_id = p_room_id;
    if found then
      return jsonb_build_object('roomStatus', v_room.status, 'revision', v_room.revision, 'memberCount', v_room.member_count,
        'phase', 'final', 'scores', v_result.result -> 'scores', 'awards', v_result.result -> 'awards', 'resultExpiresAt', v_result.result_expires_at);
    end if;
    if v_room.status = 'ended' then
      return jsonb_build_object('roomStatus', v_room.status, 'revision', v_room.revision, 'memberCount', v_room.member_count, 'phase', 'ended');
    end if;
    return null;
  end if;
  if v_room.status = 'playing' and v_room.expires_at > now() and v_game.phase in ('take', 'vote') then
    select * into v_take from public.one_cut_takes where room_id = p_room_id and take_no = v_game.take_no;
    v_due := found and ((v_game.phase = 'take' and v_take.cut_at is not null and now() >= v_take.cut_at + interval '0.5 seconds')
                        or (v_game.phase = 'vote' and v_take.vote_deadline is not null and now() >= v_take.vote_deadline));
  end if;
  if v_due then
    perform public.one_cut_expire(p_room_id, v_game.take_no); -- takes the room's write lock, held until we return
  else
    perform 1 from public.group_rooms where id = p_room_id for share;
  end if;
  select * into v_room from public.group_rooms where id = p_room_id;
  select * into v_game from public.one_cut_games where room_id = p_room_id;
  if v_game.take_no > 0 and v_game.phase in ('brief', 'take', 'vote', 'result') then
    select * into v_take from public.one_cut_takes where room_id = p_room_id and take_no = v_game.take_no;
    v_has_take := found;
  end if;
  if v_has_take then
    if v_game.phase in ('vote', 'result') then select count(*) into v_voted from public.one_cut_votes where take_id = v_take.id; end if;
    if p_member_id is not null then select exists (select 1 from public.one_cut_votes where take_id = v_take.id and voter_id = p_member_id) into v_has_voted; end if;
    if v_game.phase = 'result' then
      v_answer := v_take.answer_index;
      v_votes := coalesce((select jsonb_agg(jsonb_build_object('voter_id', voter_id, 'choice', choice)) from public.one_cut_votes where take_id = v_take.id), '[]'::jsonb);
    elsif p_member_id is not null and v_take.actor_member_id = p_member_id then
      v_my_answer := v_take.answer_index;
    end if;
  end if;
  if v_game.phase = 'break' then
    -- every take of the lap is over (result or skipped); a skipped take reveals nothing
    v_lap_takes := coalesce((select jsonb_agg(jsonb_build_object('takeNo', t.take_no, 'actorMemberId', t.actor_member_id, 'skipped', t.status <> 'result',
        'sceneText', case when t.status = 'result' then t.option_texts ->> t.answer_index else null end) order by t.take_no)
      from public.one_cut_takes t where t.room_id = p_room_id and t.lap_no = v_game.lap_no), '[]'::jsonb);
    select count(*) into v_liked from public.one_cut_likes where room_id = p_room_id and lap_no = v_game.lap_no;
    if p_member_id is not null then select target_id into v_my_like from public.one_cut_likes where room_id = p_room_id and lap_no = v_game.lap_no and voter_id = p_member_id; end if;
  end if;
  return jsonb_build_object(
    'roomStatus', v_room.status, 'revision', v_room.revision, 'memberCount', v_room.member_count,
    'phase', v_game.phase, 'mode', v_game.mode, 'startStyle', v_game.start_style, 'lapsTotal', v_game.laps_total, 'lapsAuto', v_game.laps_auto,
    'lapNo', v_game.lap_no, 'takeNo', v_game.take_no, 'scores', v_game.scores, 'awards', v_game.awards,
    'take', case when v_has_take then jsonb_build_object('actorMemberId', v_take.actor_member_id, 'options', v_take.options, 'optionTexts', v_take.option_texts, 'status', v_take.status,
      'takeStartedAt', v_take.take_started_at, 'actionAt', v_take.action_at, 'cutAt', v_take.cut_at, 'voteDeadline', v_take.vote_deadline) else null end,
    'votedCount', v_voted, 'memberHasVoted', v_has_voted, 'myAnswerIndex', v_my_answer, 'answerIndex', v_answer, 'votes', v_votes,
    'lapTakes', v_lap_takes, 'myLikeTargetId', v_my_like, 'likedCount', v_liked);
end;
$$;

revoke all on function public.one_cut_create_room(uuid,text,text,text,timestamptz,jsonb,integer,text,text) from public, anon, authenticated;
revoke all on function public.one_cut_start_take(uuid,uuid,integer,integer,uuid,jsonb,integer,jsonb,text,bigint) from public, anon, authenticated;
revoke all on function public.one_cut_to_break(uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.one_cut_ready(uuid,integer,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.one_cut_expire(uuid,integer) from public, anon, authenticated;
revoke all on function public.one_cut_cast_vote(uuid,integer,uuid,integer) from public, anon, authenticated;
revoke all on function public.one_cut_close_vote(uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.one_cut_skip(uuid,integer,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.one_cut_like(uuid,integer,uuid,uuid) from public, anon, authenticated;
revoke all on function public.one_cut_close_break(uuid,integer,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.one_cut_finish(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.one_cut_state(uuid,uuid) from public, anon, authenticated;
grant execute on function public.one_cut_create_room(uuid,text,text,text,timestamptz,jsonb,integer,text,text) to service_role;
grant execute on function public.one_cut_start_take(uuid,uuid,integer,integer,uuid,jsonb,integer,jsonb,text,bigint) to service_role;
grant execute on function public.one_cut_to_break(uuid,integer,uuid) to service_role;
grant execute on function public.one_cut_ready(uuid,integer,uuid,timestamptz) to service_role;
grant execute on function public.one_cut_expire(uuid,integer) to service_role;
grant execute on function public.one_cut_cast_vote(uuid,integer,uuid,integer) to service_role;
grant execute on function public.one_cut_close_vote(uuid,integer,uuid) to service_role;
grant execute on function public.one_cut_skip(uuid,integer,uuid,jsonb) to service_role;
grant execute on function public.one_cut_like(uuid,integer,uuid,uuid) to service_role;
grant execute on function public.one_cut_close_break(uuid,integer,uuid,jsonb) to service_role;
grant execute on function public.one_cut_finish(uuid,uuid,integer) to service_role;
grant execute on function public.one_cut_state(uuid,uuid) to service_role;

commit;
