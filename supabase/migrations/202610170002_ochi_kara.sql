-- 「オチから話して」(game_type='ochi_kara', group play only).
-- Depends on 202610170001_group_game_types.sql, which already allows 'ochi_kara' in the
-- group_rooms.game_type CHECK. This migration deliberately does not touch that constraint.
--
-- Secrecy model: every table is service_role only and every transition is a security-definer RPC.
-- A turn's answer (real story / made-up story) is stored in ochi_turns.truth when the speaker
-- finishes telling, but it is revealed only through vote -> reveal -> result. ochi_reveal is the only
-- way to reach 'result'; casting the last vote stops at 'reveal'.
-- Retention (PO decision 2026-10-09): when the game ends the whole ochi_games row (pool, hands, turns, votes, scores) is deleted
-- at once. Only a minimal result -- the title winners and each member's own tally -- is kept in ochi_results for 5 minutes so
-- every device can still show the closing screen, then it is deleted (lazily on state reads and by the group cleanup). The API
-- returns each member only their own score; nobody else's points leave the server.
begin;

create table if not exists public.ochi_games (
  room_id uuid primary key references public.group_rooms(id) on delete cascade,
  pool jsonb not null check (jsonb_typeof(pool) = 'array' and jsonb_array_length(pool) between 6 and 200),
  used jsonb not null default '[]'::jsonb check (jsonb_typeof(used) = 'array'),
  laps integer not null default 1 check (laps in (1, 2)),
  turn_order jsonb not null default '[]'::jsonb check (jsonb_typeof(turn_order) = 'array'),
  turn_no integer not null default 0 check (turn_no between 0 and 16),
  phase text not null default 'lobby' check (phase in ('lobby','deal','ready','telling','vote','reveal','result','skipped')),
  hands jsonb not null default '{}'::jsonb check (jsonb_typeof(hands) = 'object'),
  confirmed jsonb not null default '{}'::jsonb check (jsonb_typeof(confirmed) = 'object'),
  scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
  updated_at timestamptz not null default now(),
  constraint ochi_games_size check (octet_length(pool::text) <= 262144 and octet_length(hands::text) <= 65536)
);

create table if not exists public.ochi_turns (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ochi_games(room_id) on delete cascade,
  turn_no integer not null check (turn_no between 1 and 16),
  speaker_id uuid not null references public.group_members(id) on delete cascade,
  ochi_text text not null check (length(ochi_text) <= 64),
  tell_started_at timestamptz,
  tell_deadline timestamptz,
  truth text check (truth in ('real', 'fiction')),
  -- lets the server learn "is the answer registered" without ever selecting the answer itself
  truth_locked boolean generated always as (truth is not null) stored,
  score_delta jsonb not null default '{}'::jsonb check (jsonb_typeof(score_delta) = 'object'),
  status text not null default 'ready' check (status in ('ready','telling','vote','reveal','result','skipped')),
  created_at timestamptz not null default now(),
  unique (room_id, turn_no)
);

create table if not exists public.ochi_votes (
  turn_id uuid not null references public.ochi_turns(id) on delete cascade,
  voter_id uuid not null references public.group_members(id) on delete cascade,
  guess text not null check (guess in ('real', 'fiction', 'pass')),
  created_at timestamptz not null default now(),
  primary key (turn_id, voter_id)
);

-- The only thing that outlives a finished game, and only until result_expires_at (end of game + 5 minutes).
-- result = {laps, totalTurns, detective: [member ids], mysterious: [member ids], scores: {member id: {listener, teller}}}.
create table if not exists public.ochi_results (
  room_id uuid primary key references public.group_rooms(id) on delete cascade,
  result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 8192),
  result_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists ochi_results_expiry_idx on public.ochi_results(result_expires_at);
create index if not exists ochi_turns_room_idx on public.ochi_turns(room_id, turn_no);
create index if not exists ochi_votes_turn_idx on public.ochi_votes(turn_id);

alter table public.ochi_games enable row level security;
alter table public.ochi_turns enable row level security;
alter table public.ochi_votes enable row level security;
alter table public.ochi_results enable row level security;
revoke all on public.ochi_games, public.ochi_turns, public.ochi_votes, public.ochi_results from anon, authenticated;
grant all on public.ochi_games, public.ochi_turns, public.ochi_votes, public.ochi_results to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by any API role; used only inside the RPCs below)
-- ---------------------------------------------------------------------------

-- Hands are {member_id: {idx, text}}. Every idx must exist in the pool snapshot, carry the pool's
-- own text, be unused so far, and be unique within the batch. p_exact requires one hand per member.
create or replace function public.ochi_hands_ok(p_pool jsonb, p_used jsonb, p_hands jsonb, p_room_id uuid, p_exact boolean)
returns boolean language sql stable set search_path = public as $$
  select jsonb_typeof(p_hands) = 'object'
    and (select count(*) from jsonb_object_keys(p_hands)) > 0
    and (not p_exact or (select count(*) from jsonb_object_keys(p_hands)) = (select count(*) from public.group_members where room_id = p_room_id))
    and not exists (
      select 1 from jsonb_each(p_hands) h
      where jsonb_typeof(h.value) is distinct from 'object'
        or jsonb_typeof(h.value -> 'idx') is distinct from 'number'
        or jsonb_typeof(h.value -> 'text') is distinct from 'string'
        or not exists (select 1 from public.group_members gm where gm.room_id = p_room_id and gm.id::text = h.key)
        or (h.value ->> 'idx')::integer < 0
        or (h.value ->> 'idx')::integer >= jsonb_array_length(p_pool)
        or (p_pool -> ((h.value ->> 'idx')::integer)) ->> 'text' is distinct from h.value ->> 'text'
        or exists (select 1 from jsonb_array_elements_text(p_used) u where u::integer = (h.value ->> 'idx')::integer)
    )
    and (select count(distinct h.value ->> 'idx') from jsonb_each(p_hands) h) = (select count(*) from jsonb_object_keys(p_hands));
$$;

-- The speaker of the turn, or the host acting on the speaker's behalf.
create or replace function public.ochi_actor_ok(p_room_id uuid, p_member_id uuid, p_speaker_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where id = p_member_id and room_id = p_room_id and (id = p_speaker_id or role = 'host')
  );
$$;

-- Creates the ochi_turns row for game.turn_no (speaker = turn_order[turn_no-1], text = that member's
-- hand) and moves the game to 'ready'. The caller already holds the room and game row locks.
create or replace function public.ochi_open_turn(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game public.ochi_games;
  v_speaker uuid;
  v_text text;
begin
  select * into v_game from public.ochi_games where room_id = p_room_id;
  v_speaker := (v_game.turn_order ->> (v_game.turn_no - 1))::uuid;
  v_text := v_game.hands -> (v_speaker::text) ->> 'text';
  if v_speaker is null or v_text is null then raise exception 'OCHI_INVALID'; end if;
  insert into public.ochi_turns(room_id, turn_no, speaker_id, ochi_text, status)
    values (p_room_id, v_game.turn_no, v_speaker, v_text, 'ready');
  update public.ochi_games set phase = 'ready', updated_at = now() where room_id = p_room_id;
end;
$$;

revoke all on function public.ochi_hands_ok(jsonb,jsonb,jsonb,uuid,boolean) from public, anon, authenticated, service_role;
revoke all on function public.ochi_actor_ok(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.ochi_open_turn(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create
-- ---------------------------------------------------------------------------
create or replace function public.ochi_create_room(p_host_user_id uuid, p_invite_hash text, p_host_secret_hash text, p_host_name text, p_expires_at timestamptz, p_pool jsonb, p_laps integer)
returns table(room_id uuid, host_member_id uuid) language plpgsql security definer set search_path = public as $$
declare
  v_room uuid;
  v_member uuid;
  v_cards jsonb;
begin
  if p_host_user_id is null or p_laps is null or p_laps not in (1, 2) or p_pool is null
     or jsonb_typeof(p_pool) is distinct from 'array' or jsonb_array_length(p_pool) not between 6 and 200 or octet_length(p_pool::text) > 262144
     or exists (select 1 from jsonb_array_elements(p_pool) x
                where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x -> 'id') is distinct from 'string'
                   or jsonb_typeof(x -> 'text') is distinct from 'string' or jsonb_typeof(x -> 'category') is distinct from 'string'
                   or nullif(x ->> 'text', '') is null or length(x ->> 'text') > 64 or length(x ->> 'id') > 64)
     or (select count(distinct x ->> 'id') from jsonb_array_elements(p_pool) x) <> jsonb_array_length(p_pool) then
    raise exception 'OCHI_INVALID';
  end if;
  -- group_rooms.cards must hold 6..40 entries; use neutral placeholders so no card text sits in the room row.
  v_cards := (select jsonb_agg(jsonb_build_object('id', 'ochi_kara:' || (ord - 1)::text, 'text', 'オチカード', 'r18', false, 'sourceDeckId', 'ochi_kara', 'participantRule', 'group') order by ord)
              from jsonb_array_elements(p_pool) with ordinality x(c, ord) where ord <= 40);
  insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only, member_count, expires_at, game_type)
    values (p_host_user_id, p_invite_hash, 'ochi_kara', 'オチから話して', v_cards, false, 1, p_expires_at, 'ochi_kara') returning id into v_room;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed)
    values (v_room, p_host_secret_hash, left(p_host_name, 40), 'host', true) returning id into v_member;
  insert into public.ochi_games(room_id, pool, laps) values (v_room, p_pool, p_laps);
  return query select v_room, v_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- start: lobby -> deal (host). Order and hands are drawn by the server; everything is re-verified here.
-- ---------------------------------------------------------------------------
create or replace function public.ochi_start(p_room_id uuid, p_member_id uuid, p_expected_revision bigint, p_turn_order jsonb, p_hands jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_n integer;
  v_lap integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'lobby' then raise exception 'OCHI_PHASE'; end if;
  if v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'lobby' then raise exception 'OCHI_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
  select count(*) into v_n from public.group_members where room_id = p_room_id;
  if v_n < 2 or v_n > 8 then raise exception 'OCHI_PARTICIPANTS'; end if;
  if jsonb_typeof(p_turn_order) is distinct from 'array' or jsonb_array_length(p_turn_order) <> v_n * v_game.laps then raise exception 'OCHI_INVALID'; end if;
  -- every lap must be a permutation of the room's members
  for v_lap in 0 .. v_game.laps - 1 loop
    if (select count(distinct t.value) from jsonb_array_elements_text(p_turn_order) with ordinality t(value, ord) where t.ord > v_lap * v_n and t.ord <= (v_lap + 1) * v_n) <> v_n
       or exists (select 1 from jsonb_array_elements_text(p_turn_order) with ordinality t(value, ord)
                  where t.ord > v_lap * v_n and t.ord <= (v_lap + 1) * v_n
                    and not exists (select 1 from public.group_members gm where gm.room_id = p_room_id and gm.id::text = t.value)) then
      raise exception 'OCHI_INVALID';
    end if;
  end loop;
  if not public.ochi_hands_ok(v_game.pool, v_game.used, p_hands, p_room_id, true) then raise exception 'OCHI_INVALID'; end if;
  update public.ochi_games set
    turn_order = p_turn_order,
    turn_no = 1,
    phase = 'deal',
    hands = (select jsonb_object_agg(h.key, jsonb_build_object('idx', (h.value ->> 'idx')::integer, 'text', h.value ->> 'text', 'swapUsed', false)) from jsonb_each(p_hands) h),
    used = v_game.used || (select jsonb_agg((h.value ->> 'idx')::integer) from jsonb_each(p_hands) h),
    confirmed = '{}'::jsonb,
    scores = (select jsonb_object_agg(gm.id::text, jsonb_build_object('listener', 0, 'teller', 0)) from public.group_members gm where gm.room_id = p_room_id),
    updated_at = now()
  where room_id = p_room_id;
  update public.group_rooms set status = 'playing', revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm: each member acknowledges their hand (no revision; keyed by turn number)
-- ---------------------------------------------------------------------------
create or replace function public.ochi_confirm(p_room_id uuid, p_turn_no integer, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_confirmed jsonb;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase <> 'deal' then raise exception 'OCHI_PHASE'; end if;
  if not (v_game.hands ? p_member_id::text) then raise exception 'FORBIDDEN'; end if;
  if v_game.confirmed ? p_member_id::text then return; end if;
  v_confirmed := v_game.confirmed || jsonb_build_object(p_member_id::text, true);
  update public.ochi_games set confirmed = v_confirmed, updated_at = now() where room_id = p_room_id;
  if (select count(*) from jsonb_object_keys(v_confirmed)) >= (select count(*) from jsonb_object_keys(v_game.hands)) then
    perform public.ochi_open_turn(p_room_id);
  end if;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

create or replace function public.ochi_force_ready(p_room_id uuid, p_turn_no integer, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase <> 'deal' then raise exception 'OCHI_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
  perform public.ochi_open_turn(p_room_id);
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- swap: redraw your own hand once per game (no revision; checked by turn number, own swapUsed and phase)
-- p_new_hand is {idx, text} drawn by the server; the old card stays in `used` and is never dealt again.
-- ---------------------------------------------------------------------------
create or replace function public.ochi_swap(p_room_id uuid, p_turn_no integer, p_member_id uuid, p_new_hand jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_hand jsonb;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  v_hand := v_game.hands -> (p_member_id::text);
  if v_hand is null then raise exception 'FORBIDDEN'; end if;
  if coalesce((v_hand ->> 'swapUsed')::boolean, false) then raise exception 'OCHI_SWAP_USED'; end if;
  if not (v_game.phase = 'deal' or (v_game.phase = 'ready' and (v_game.turn_order ->> (v_game.turn_no - 1)) = p_member_id::text)) then raise exception 'OCHI_PHASE'; end if;
  -- a concurrent redraw may have taken the same card: report it as a stale write so the server retries
  if not public.ochi_hands_ok(v_game.pool, v_game.used, jsonb_build_object(p_member_id::text, p_new_hand), p_room_id, false) then raise exception 'GROUP_STALE'; end if;
  update public.ochi_games set
    hands = v_game.hands || jsonb_build_object(p_member_id::text, jsonb_build_object('idx', (p_new_hand ->> 'idx')::integer, 'text', p_new_hand ->> 'text', 'swapUsed', true)),
    used = v_game.used || to_jsonb((p_new_hand ->> 'idx')::integer),
    confirmed = case when v_game.phase = 'deal' then v_game.confirmed - p_member_id::text else v_game.confirmed end,
    updated_at = now()
  where room_id = p_room_id;
  if v_game.phase = 'ready' then
    update public.ochi_turns set ochi_text = p_new_hand ->> 'text' where room_id = p_room_id and turn_no = v_game.turn_no and status = 'ready';
  end if;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Progress operations after start carry no revision: each is identified by turn number + phase (+ actor), so a
-- participant's vote/confirm/swap moving the room revision never makes the host's next click fail.
-- begin_tell: ready -> telling (speaker or host proxy). Starts the 60 second clock; nothing is enforced at expiry.
-- ---------------------------------------------------------------------------
create or replace function public.ochi_begin_tell(p_room_id uuid, p_turn_no integer, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_turn public.ochi_turns;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase <> 'ready' then raise exception 'OCHI_PHASE'; end if;
  select * into v_turn from public.ochi_turns where room_id = p_room_id and turn_no = p_turn_no for update;
  if not found or v_turn.status <> 'ready' then raise exception 'OCHI_PHASE'; end if;
  if not public.ochi_actor_ok(p_room_id, p_member_id, v_turn.speaker_id) then raise exception 'OCHI_TURN'; end if;
  update public.ochi_turns set status = 'telling', tell_started_at = now(), tell_deadline = now() + interval '60 seconds' where id = v_turn.id;
  update public.ochi_games set phase = 'telling', updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_tell: telling -> vote. The speaker registers the secret answer here. When the host finishes on the
-- speaker's behalf, p_truth is ignored (the host does not know it); the speaker supplies it at reveal.
-- ---------------------------------------------------------------------------
create or replace function public.ochi_finish_tell(p_room_id uuid, p_turn_no integer, p_member_id uuid, p_truth text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_turn public.ochi_turns;
  v_truth text;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase <> 'telling' then raise exception 'OCHI_PHASE'; end if;
  select * into v_turn from public.ochi_turns where room_id = p_room_id and turn_no = p_turn_no for update;
  if not found or v_turn.status <> 'telling' then raise exception 'OCHI_PHASE'; end if;
  if not public.ochi_actor_ok(p_room_id, p_member_id, v_turn.speaker_id) then raise exception 'OCHI_TURN'; end if;
  -- the host may finish for an absent speaker only 15 seconds after the clock ran out, so a proxy cannot cut a story short
  if p_member_id <> v_turn.speaker_id and now() < v_turn.tell_deadline + interval '15 seconds' then raise exception 'OCHI_PHASE'; end if;
  if p_member_id = v_turn.speaker_id then
    if p_truth is null or p_truth not in ('real', 'fiction') then raise exception 'OCHI_PHASE'; end if;
    v_truth := p_truth;
  end if;
  update public.ochi_turns set status = 'vote', truth = v_truth where id = v_turn.id;
  update public.ochi_games set phase = 'vote', updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- lock_truth: after a host proxy finished the telling (no answer registered), the speaker can still register
-- their own answer during the vote, before anyone sees results. No revision (votes keep moving it).
create or replace function public.ochi_lock_truth(p_room_id uuid, p_turn_no integer, p_member_id uuid, p_truth text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_turn public.ochi_turns;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase <> 'vote' then raise exception 'OCHI_PHASE'; end if;
  select * into v_turn from public.ochi_turns where room_id = p_room_id and turn_no = p_turn_no for update;
  if not found or v_turn.status <> 'vote' then raise exception 'OCHI_PHASE'; end if;
  if p_member_id is distinct from v_turn.speaker_id then raise exception 'OCHI_TURN'; end if;
  if v_turn.truth is not null then raise exception 'OCHI_PHASE'; end if;
  if p_truth is null or p_truth not in ('real', 'fiction') then raise exception 'OCHI_INVALID'; end if;
  update public.ochi_turns set truth = p_truth where id = v_turn.id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- skip: the speaker passes this turn (ready or telling). No points, no reason asked.
create or replace function public.ochi_skip(p_room_id uuid, p_turn_no integer, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_turn public.ochi_turns;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase not in ('ready', 'telling') then raise exception 'OCHI_PHASE'; end if;
  select * into v_turn from public.ochi_turns where room_id = p_room_id and turn_no = p_turn_no for update;
  if not found or v_turn.status not in ('ready', 'telling') then raise exception 'OCHI_PHASE'; end if;
  if not public.ochi_actor_ok(p_room_id, p_member_id, v_turn.speaker_id) then raise exception 'OCHI_TURN'; end if;
  update public.ochi_turns set status = 'skipped' where id = v_turn.id;
  update public.ochi_games set phase = 'skipped', updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- cast_vote: a listener guesses real / fiction / pass (no revision). When everyone has voted the turn
-- moves to 'reveal' -- never straight to 'result'.
-- ---------------------------------------------------------------------------
create or replace function public.ochi_cast_vote(p_room_id uuid, p_turn_no integer, p_voter_id uuid, p_guess text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_turn public.ochi_turns;
  v_votes integer;
  v_voters integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase <> 'vote' then raise exception 'OCHI_VOTE_CLOSED'; end if;
  select * into v_turn from public.ochi_turns where room_id = p_room_id and turn_no = p_turn_no for update;
  if not found or v_turn.status <> 'vote' then raise exception 'OCHI_VOTE_CLOSED'; end if;
  if p_guess is null or p_guess not in ('real', 'fiction', 'pass') then raise exception 'OCHI_INVALID'; end if;
  if not exists (select 1 from public.group_members where id = p_voter_id and room_id = p_room_id) or not (v_game.hands ? p_voter_id::text) then raise exception 'FORBIDDEN'; end if;
  if p_voter_id = v_turn.speaker_id then raise exception 'OCHI_TURN'; end if;
  if exists (select 1 from public.ochi_votes where turn_id = v_turn.id and voter_id = p_voter_id) then raise exception 'OCHI_ALREADY_VOTED'; end if;
  insert into public.ochi_votes(turn_id, voter_id, guess) values (v_turn.id, p_voter_id, p_guess);
  select count(*) into v_votes from public.ochi_votes where turn_id = v_turn.id;
  select count(*) - 1 into v_voters from public.group_members where room_id = p_room_id;
  if v_votes >= v_voters then
    update public.ochi_turns set status = 'reveal' where id = v_turn.id;
    update public.ochi_games set phase = 'reveal', updated_at = now() where room_id = p_room_id;
  end if;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- close_vote: the host ends voting early (e.g. someone dropped off). vote -> reveal.
create or replace function public.ochi_close_vote(p_room_id uuid, p_turn_no integer, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_turn public.ochi_turns;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase <> 'vote' then raise exception 'OCHI_VOTE_CLOSED'; end if;
  select * into v_turn from public.ochi_turns where room_id = p_room_id and turn_no = p_turn_no for update;
  if not found or v_turn.status <> 'vote' then raise exception 'OCHI_VOTE_CLOSED'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
  update public.ochi_turns set status = 'reveal' where id = v_turn.id;
  update public.ochi_games set phase = 'reveal', updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- reveal: reveal -> result, the only path to 'result'. The speaker (or the host as proxy) discloses the answer.
-- An answer registered at finish_tell wins over p_truth; if none was registered, p_truth is required.
-- Scoring happens here: listener +1 per correct guess; teller +1 when a strict majority of non-pass votes missed.
-- ---------------------------------------------------------------------------
create or replace function public.ochi_reveal(p_room_id uuid, p_turn_no integer, p_member_id uuid, p_truth text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_turn public.ochi_turns;
  v_truth text;
  v_voted integer;
  v_wrong integer;
  v_delta jsonb;
  v_proxy boolean := false;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase = 'vote' then raise exception 'OCHI_NOT_REVEALED'; end if;
  if v_game.phase <> 'reveal' then raise exception 'OCHI_PHASE'; end if;
  select * into v_turn from public.ochi_turns where room_id = p_room_id and turn_no = p_turn_no for update;
  if not found or v_turn.status <> 'reveal' then raise exception 'OCHI_PHASE'; end if;
  if not public.ochi_actor_ok(p_room_id, p_member_id, v_turn.speaker_id) then raise exception 'OCHI_TURN'; end if;
  v_truth := v_turn.truth;
  if v_truth is null then
    if p_truth is null or p_truth not in ('real', 'fiction') then raise exception 'OCHI_PHASE'; end if;
    v_truth := p_truth;
    v_proxy := p_member_id <> v_turn.speaker_id;
  end if;
  select count(*) filter (where guess <> 'pass'), count(*) filter (where guess <> 'pass' and guess <> v_truth)
    into v_voted, v_wrong from public.ochi_votes where turn_id = v_turn.id;
  v_delta := coalesce((select jsonb_object_agg(voter_id::text, 1) from public.ochi_votes where turn_id = v_turn.id and guess = v_truth), '{}'::jsonb);
  -- a host who typed the answer in for the speaker must not score as a listener on it
  if v_proxy then v_delta := v_delta - p_member_id::text; end if;
  if v_voted > 0 and v_wrong * 2 > v_voted then
    v_delta := v_delta || jsonb_build_object(v_turn.speaker_id::text, 1);
  end if;
  update public.ochi_games set
    phase = 'result',
    scores = (select jsonb_object_agg(s.key, jsonb_build_object(
        'listener', (s.value ->> 'listener')::integer + case when s.key <> v_turn.speaker_id::text and v_delta ? s.key then 1 else 0 end,
        'teller', (s.value ->> 'teller')::integer + case when s.key = v_turn.speaker_id::text and v_delta ? s.key then 1 else 0 end))
      from jsonb_each(v_game.scores) s),
    updated_at = now()
  where room_id = p_room_id;
  update public.ochi_turns set status = 'result', truth = v_truth, score_delta = v_delta where id = v_turn.id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- next_turn: result/skipped -> ready(t+1), or deal when a new lap starts (p_hands = fresh hands), or the end of the game.
-- After the last turn the whole game row is deleted (turns, votes, hands, answers, pool, scores). Only a minimal result
-- (title winners + each member's own tally) is stored in ochi_results for 5 minutes; the room ends right away.
-- ---------------------------------------------------------------------------
create or replace function public.ochi_next_turn(p_room_id uuid, p_turn_no integer, p_member_id uuid, p_hands jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.ochi_games;
  v_total integer;
  v_n integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'OCHI_PHASE'; end if;
  select * into v_game from public.ochi_games where room_id = p_room_id for update;
  if not found or v_game.turn_no <> p_turn_no then raise exception 'OCHI_STALE_TURN'; end if;
  if v_game.phase not in ('result', 'skipped') then raise exception 'OCHI_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
  v_total := jsonb_array_length(v_game.turn_order);
  v_n := v_total / v_game.laps;
  if v_game.turn_no >= v_total then
    insert into public.ochi_results(room_id, result, result_expires_at)
      values (p_room_id, jsonb_build_object(
        'laps', v_game.laps,
        'totalTurns', v_total,
        'detective', coalesce((select jsonb_agg(s.key order by s.key) from jsonb_each(v_game.scores) s
                               where (s.value ->> 'listener')::integer > 0
                                 and (s.value ->> 'listener')::integer = (select max((x.value ->> 'listener')::integer) from jsonb_each(v_game.scores) x)), '[]'::jsonb),
        'mysterious', coalesce((select jsonb_agg(s.key order by s.key) from jsonb_each(v_game.scores) s
                                where (s.value ->> 'teller')::integer > 0
                                  and (s.value ->> 'teller')::integer = (select max((x.value ->> 'teller')::integer) from jsonb_each(v_game.scores) x)), '[]'::jsonb),
        'scores', v_game.scores), now() + interval '5 minutes')
      on conflict (room_id) do update set result = excluded.result, result_expires_at = excluded.result_expires_at;
    -- deleting the game row cascades turns (answers) and votes; hands, pool and scores go with it
    delete from public.ochi_games where room_id = p_room_id;
    -- the room stops counting toward the host's active-room cap
    update public.group_rooms set status = 'ended', revealed = false where id = p_room_id;
  elsif v_game.turn_no % v_n = 0 then
    -- a new lap: everyone is dealt a fresh hand; each member keeps their own swapUsed flag for the whole game
    if not public.ochi_hands_ok(v_game.pool, v_game.used, p_hands, p_room_id, true) then raise exception 'OCHI_INVALID'; end if;
    update public.ochi_games set
      turn_no = v_game.turn_no + 1,
      phase = 'deal',
      hands = (select jsonb_object_agg(h.key, jsonb_build_object('idx', (h.value ->> 'idx')::integer, 'text', h.value ->> 'text',
                'swapUsed', coalesce((v_game.hands -> h.key ->> 'swapUsed')::boolean, false))) from jsonb_each(p_hands) h),
      used = v_game.used || (select jsonb_agg((h.value ->> 'idx')::integer) from jsonb_each(p_hands) h),
      confirmed = '{}'::jsonb,
      updated_at = now()
    where room_id = p_room_id;
  else
    update public.ochi_games set turn_no = v_game.turn_no + 1, updated_at = now() where room_id = p_room_id;
    perform public.ochi_open_turn(p_room_id);
  end if;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- finish: host ends the game from lobby or play. The whole ochi_games row (hands, answers, votes, scores) is erased at once and,
-- unlike a game played to the end, no result is kept.
-- ---------------------------------------------------------------------------
create or replace function public.ochi_finish(p_room_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'ochi_kara' or v_room.expires_at <= now() or v_room.status not in ('lobby', 'playing') then raise exception 'OCHI_PHASE'; end if;
  perform 1 from public.ochi_games where room_id = p_room_id for update;
  if not found then raise exception 'OCHI_NOT_STARTED'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'FORBIDDEN'; end if;
  -- removing the game row cascades turns (answers) and votes; hands and scores go with it
  delete from public.ochi_games where room_id = p_room_id;
  update public.group_rooms set status = 'ended', revealed = false where id = p_room_id;
end;
$$;

revoke all on function public.ochi_create_room(uuid,text,text,text,timestamptz,jsonb,integer) from public, anon, authenticated;
revoke all on function public.ochi_start(uuid,uuid,bigint,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.ochi_confirm(uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.ochi_force_ready(uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.ochi_swap(uuid,integer,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.ochi_begin_tell(uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.ochi_finish_tell(uuid,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.ochi_lock_truth(uuid,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.ochi_skip(uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.ochi_cast_vote(uuid,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.ochi_close_vote(uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.ochi_reveal(uuid,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.ochi_next_turn(uuid,integer,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.ochi_finish(uuid,uuid) from public, anon, authenticated;
grant execute on function public.ochi_create_room(uuid,text,text,text,timestamptz,jsonb,integer) to service_role;
grant execute on function public.ochi_start(uuid,uuid,bigint,jsonb,jsonb) to service_role;
grant execute on function public.ochi_confirm(uuid,integer,uuid) to service_role;
grant execute on function public.ochi_force_ready(uuid,integer,uuid) to service_role;
grant execute on function public.ochi_swap(uuid,integer,uuid,jsonb) to service_role;
grant execute on function public.ochi_begin_tell(uuid,integer,uuid) to service_role;
grant execute on function public.ochi_finish_tell(uuid,integer,uuid,text) to service_role;
grant execute on function public.ochi_lock_truth(uuid,integer,uuid,text) to service_role;
grant execute on function public.ochi_skip(uuid,integer,uuid) to service_role;
grant execute on function public.ochi_cast_vote(uuid,integer,uuid,text) to service_role;
grant execute on function public.ochi_close_vote(uuid,integer,uuid) to service_role;
grant execute on function public.ochi_reveal(uuid,integer,uuid,text) to service_role;
grant execute on function public.ochi_next_turn(uuid,integer,uuid,jsonb) to service_role;
grant execute on function public.ochi_finish(uuid,uuid) to service_role;

commit;
