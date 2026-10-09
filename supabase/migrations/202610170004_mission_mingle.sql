-- 「ミッション・ミングル」(game_type='mission_mingle', group play only).
-- Depends on 202610170001_group_game_types.sql, which already allows 'mission_mingle' in the
-- group_rooms.game_type CHECK. This migration deliberately does not touch that constraint.
--
-- Secrecy / retention model: every table is service_role only and every transition is a security-definer RPC.
-- Each member holds three secret missions (mission_assignments). Only the catalog id, the optional target member,
-- the topic tag and a status flag are stored -- never an answer, a timestamp of achievement or who asked whom.
-- mission_reveal_start erases every row that is not an achieved mission.
-- Retention (PO decision 2026-10-09): when the last person has been revealed (mission_reveal_next) the whole mission_games row
-- (assignments, swaps, reveal order) is deleted at once and the room ends. Only the closing summary -- the achieved total and each
-- member's own achieved count + titles -- is copied into mission_results for 5 minutes, so every device can still show it; it is then
-- deleted (lazily on state reads and by the group cleanup). The API returns each member only their own count and titles.
-- mission_finish deletes the whole game (assignments, swaps) with no summary; the 24h room expiry cascades the same.
-- The room revision moves only on whole-game transitions (join, configure, start, extend, end_now, expire, reveal_*, finish);
-- achieve / pass / swap never touch it so a member's private taps cannot make the representative's actions stale.
begin;

create table if not exists public.mission_games (
  room_id uuid primary key references public.group_rooms(id) on delete cascade,
  duration_minutes integer not null default 60 check (duration_minutes in (30, 60, 120)),
  preset text not null default 'standard' check (preset in ('easy', 'standard', 'hard')),
  scene text not null default 'party' check (scene in ('party', 'mixer', 'business')),
  seat_mode boolean not null default false,
  phase text not null default 'lobby' check (phase in ('lobby', 'mission', 'reveal_ready', 'reveal')),
  started_at timestamptz,
  ends_at timestamptz,
  extensions integer not null default 0 check (extensions between 0 and 2),
  reveal_order jsonb not null default '[]'::jsonb check (jsonb_typeof(reveal_order) = 'array'),
  reveal_cursor integer not null default 0 check (reveal_cursor between 0 and 8),
  updated_at timestamptz not null default now(),
  check (ends_at is null or (started_at is not null and ends_at >= started_at))
);

-- The only thing that outlives a finished game, and only until result_expires_at (end of game + 5 minutes).
-- result = {achievedTotal, members: {member id: {achieved, titles: [text]}}}.
create table if not exists public.mission_results (
  room_id uuid primary key references public.group_rooms(id) on delete cascade,
  result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 8192),
  result_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists mission_results_expiry_idx on public.mission_results(result_expires_at);

create table if not exists public.mission_assignments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.mission_games(room_id) on delete cascade,
  member_id uuid not null references public.group_members(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  mission_id text not null check (mission_id ~ '^mission-[0-9]{3,4}$'),
  difficulty smallint not null check (difficulty between 1 and 3),
  topic text not null check (char_length(topic) between 1 and 40),
  target_member_id uuid references public.group_members(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'achieved', 'passed', 'swapped'))
);
-- the same mission id is never dealt twice in one game, not even after a swap (H1)
create unique index if not exists mission_assignments_room_mission_uidx on public.mission_assignments(room_id, mission_id);
-- one live (active / achieved) mission per slot
create unique index if not exists mission_assignments_live_slot_uidx on public.mission_assignments(member_id, slot) where status in ('active', 'achieved');
-- two members never chase the same topic on the same person (H3)
create unique index if not exists mission_assignments_target_topic_uidx on public.mission_assignments(room_id, target_member_id, topic) where target_member_id is not null and status in ('active', 'achieved');
create index if not exists mission_assignments_member_idx on public.mission_assignments(room_id, member_id);

create table if not exists public.mission_swaps (
  room_id uuid not null references public.mission_games(room_id) on delete cascade,
  member_id uuid not null references public.group_members(id) on delete cascade,
  used integer not null default 0 check (used between 0 and 3),
  primary key (room_id, member_id)
);

alter table public.mission_games enable row level security;
alter table public.mission_assignments enable row level security;
alter table public.mission_swaps enable row level security;
alter table public.mission_results enable row level security;
revoke all on public.mission_games, public.mission_assignments, public.mission_swaps, public.mission_results from anon, authenticated;
grant all on public.mission_games, public.mission_assignments, public.mission_swaps, public.mission_results to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by any API role; used only inside the RPCs below)
-- ---------------------------------------------------------------------------

-- {durationMinutes, preset, scene, seatMode}: every key optional, unknown keys rejected.
create or replace function public.mission_settings_ok(p_settings jsonb)
returns boolean language sql immutable set search_path = public as $$
  select p_settings is not null and jsonb_typeof(p_settings) = 'object'
    and not exists (select 1 from jsonb_object_keys(p_settings) k where k not in ('durationMinutes', 'preset', 'scene', 'seatMode'))
    and (not (p_settings ? 'durationMinutes') or (jsonb_typeof(p_settings -> 'durationMinutes') = 'number' and (p_settings ->> 'durationMinutes') in ('30', '60', '120')))
    and (not (p_settings ? 'preset') or (jsonb_typeof(p_settings -> 'preset') = 'string' and (p_settings ->> 'preset') in ('easy', 'standard', 'hard')))
    and (not (p_settings ? 'scene') or (jsonb_typeof(p_settings -> 'scene') = 'string' and (p_settings ->> 'scene') in ('party', 'mixer', 'business')))
    and (not (p_settings ? 'seatMode') or jsonb_typeof(p_settings -> 'seatMode') = 'boolean');
$$;

-- The three difficulties every member must hold, in ascending order.
create or replace function public.mission_preset_difficulties(p_preset text)
returns integer[] language sql immutable set search_path = public as $$
  select case p_preset when 'easy' then array[1, 1, 2] when 'standard' then array[1, 2, 3] else array[2, 3, 3] end;
$$;

-- Validates one {missionId, difficulty, topic, targetMemberId} object (no uuid casts of untrusted text).
create or replace function public.mission_item_ok(p_room_id uuid, p_item jsonb, p_owner_text text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_difficulty numeric;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then return false; end if;
  if jsonb_typeof(p_item -> 'missionId') is distinct from 'string' or jsonb_typeof(p_item -> 'topic') is distinct from 'string' or jsonb_typeof(p_item -> 'difficulty') is distinct from 'number' then return false; end if;
  if (p_item ->> 'missionId') !~ '^mission-[0-9]{3,4}$' then return false; end if;
  if char_length(p_item ->> 'topic') not between 1 and 40 then return false; end if;
  v_difficulty := (p_item ->> 'difficulty')::numeric;
  if v_difficulty <> trunc(v_difficulty) or v_difficulty not between 1 and 3 then return false; end if;
  if p_item ? 'targetMemberId' and jsonb_typeof(p_item -> 'targetMemberId') <> 'null' then
    if jsonb_typeof(p_item -> 'targetMemberId') <> 'string' then return false; end if;
    if (p_item ->> 'targetMemberId') = p_owner_text then return false; end if;
    if not exists (select 1 from public.group_members gm where gm.room_id = p_room_id and gm.id::text = p_item ->> 'targetMemberId') then return false; end if;
  end if;
  return true;
end;
$$;

-- The closing summary the API computes at the last reveal. The counts must match the achieved rows still in the database (titles are
-- display text from the catalog and only length-checked): {achievedTotal, members: {member id: {achieved, titles: [text]}}}.
create or replace function public.mission_summary_ok(p_room_id uuid, p_result jsonb)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_n integer;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p_result) k where k not in ('achievedTotal', 'members')) then return false; end if;
  if jsonb_typeof(p_result -> 'achievedTotal') is distinct from 'number' or jsonb_typeof(p_result -> 'members') is distinct from 'object' then return false; end if;
  if p_result ->> 'achievedTotal' !~ '^[0-9]{1,3}$' then return false; end if;
  if (p_result ->> 'achievedTotal')::integer <> (select count(*) from public.mission_assignments where room_id = p_room_id and status = 'achieved') then return false; end if;
  select count(*) into v_n from public.group_members where room_id = p_room_id;
  if (select count(*) from jsonb_object_keys(p_result -> 'members')) <> v_n then return false; end if;
  return not exists (
    select 1 from public.group_members gm
    where gm.room_id = p_room_id
      and (
        jsonb_typeof(p_result -> 'members' -> gm.id::text) is distinct from 'object'
        or exists (select 1 from jsonb_object_keys(p_result -> 'members' -> gm.id::text) k where k not in ('achieved', 'titles'))
        or jsonb_typeof(p_result -> 'members' -> gm.id::text -> 'achieved') is distinct from 'number'
        or (p_result -> 'members' -> gm.id::text ->> 'achieved') !~ '^[0-9]$'
        or (p_result -> 'members' -> gm.id::text ->> 'achieved')::integer <> (select count(*) from public.mission_assignments a where a.room_id = p_room_id and a.member_id = gm.id and a.status = 'achieved')
        or jsonb_typeof(p_result -> 'members' -> gm.id::text -> 'titles') is distinct from 'array'
        or jsonb_array_length(p_result -> 'members' -> gm.id::text -> 'titles') > 6
        or exists (select 1 from jsonb_array_elements(p_result -> 'members' -> gm.id::text -> 'titles') t
                   where jsonb_typeof(t) is distinct from 'string' or char_length(t #>> '{}') not between 1 and 20)
      )
  );
end;
$$;

revoke all on function public.mission_settings_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.mission_summary_ok(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.mission_preset_difficulties(text) from public, anon, authenticated, service_role;
revoke all on function public.mission_item_ok(uuid,jsonb,text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create: room + host member + game row. The room's card array holds neutral placeholders only.
-- ---------------------------------------------------------------------------
create or replace function public.mission_create_room(p_host_user_id uuid, p_invite_hash text, p_host_secret_hash text, p_host_name text, p_expires_at timestamptz, p_settings jsonb)
returns table(room_id uuid, host_member_id uuid) language plpgsql security definer set search_path = public as $$
declare
  v_room uuid;
  v_member uuid;
  v_cards jsonb;
begin
  if p_host_user_id is null or not public.mission_settings_ok(coalesce(p_settings, '{}'::jsonb)) then raise exception 'MISSION_INVALID'; end if;
  v_cards := (select jsonb_agg(jsonb_build_object('id', 'mission_mingle:' || (n - 1)::text, 'text', 'ミッションカード', 'r18', false, 'sourceDeckId', 'mission_mingle', 'participantRule', 'group') order by n)
              from generate_series(1, 6) n);
  insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only, member_count, expires_at, game_type)
    values (p_host_user_id, p_invite_hash, 'mission_mingle', 'ミッション・ミングル', v_cards, false, 1, p_expires_at, 'mission_mingle') returning id into v_room;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed)
    values (v_room, p_host_secret_hash, left(p_host_name, 40), 'host', true) returning id into v_member;
  insert into public.mission_games(room_id, duration_minutes, preset, scene, seat_mode)
    values (v_room,
      coalesce((p_settings ->> 'durationMinutes')::integer, 60),
      coalesce(p_settings ->> 'preset', 'standard'),
      coalesce(p_settings ->> 'scene', 'party'),
      coalesce((p_settings ->> 'seatMode')::boolean, false));
  return query select v_room, v_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- configure: lobby only, host only, current revision. Missing keys keep their value.
-- ---------------------------------------------------------------------------
create or replace function public.mission_configure(p_room_id uuid, p_member_id uuid, p_settings jsonb, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'lobby' then raise exception 'MISSION_PHASE'; end if;
  if v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'lobby' then raise exception 'MISSION_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'MISSION_NOT_OWNER'; end if;
  if not public.mission_settings_ok(p_settings) then raise exception 'MISSION_INVALID'; end if;
  update public.mission_games set
    duration_minutes = coalesce((p_settings ->> 'durationMinutes')::integer, duration_minutes),
    preset = coalesce(p_settings ->> 'preset', preset),
    scene = coalesce(p_settings ->> 'scene', scene),
    seat_mode = coalesce((p_settings ->> 'seatMode')::boolean, seat_mode),
    updated_at = now()
  where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- start: lobby -> mission (host). p_assignments = [{memberId, slot, missionId, difficulty, topic, targetMemberId}] built by
-- the server; everything structural is re-verified here. started_at / ends_at come from the database clock.
-- ---------------------------------------------------------------------------
create or replace function public.mission_start(p_room_id uuid, p_member_id uuid, p_assignments jsonb, p_reveal_order jsonb, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
  v_n integer;
  v_item jsonb;
  v_slot numeric;
  v_preset integer[];
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'lobby' then raise exception 'MISSION_PHASE'; end if;
  if v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'lobby' then raise exception 'MISSION_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'MISSION_NOT_OWNER'; end if;
  select count(*) into v_n from public.group_members where room_id = p_room_id;
  if v_n < 3 or v_n > 8 then raise exception 'MISSION_PARTICIPANTS'; end if;
  if now() + make_interval(mins => v_game.duration_minutes) > v_room.expires_at then raise exception 'MISSION_UNAVAILABLE'; end if;
  if jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) <> v_n * 3 then raise exception 'MISSION_INVALID'; end if;
  -- the reveal order is a permutation of the room's members
  if jsonb_typeof(p_reveal_order) is distinct from 'array' or jsonb_array_length(p_reveal_order) <> v_n
     or (select count(distinct t.value) from jsonb_array_elements_text(p_reveal_order) t) <> v_n
     or exists (select 1 from jsonb_array_elements_text(p_reveal_order) t where not exists (select 1 from public.group_members gm where gm.room_id = p_room_id and gm.id::text = t.value)) then
    raise exception 'MISSION_INVALID';
  end if;
  begin
    for v_item in select value from jsonb_array_elements(p_assignments) loop
      if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'memberId') is distinct from 'string' or jsonb_typeof(v_item -> 'slot') is distinct from 'number' then raise exception 'MISSION_INVALID'; end if;
      v_slot := (v_item ->> 'slot')::numeric;
      if v_slot <> trunc(v_slot) or v_slot not between 1 and 3 then raise exception 'MISSION_INVALID'; end if;
      if not exists (select 1 from public.group_members gm where gm.room_id = p_room_id and gm.id::text = v_item ->> 'memberId') then raise exception 'MISSION_INVALID'; end if;
      if not public.mission_item_ok(p_room_id, v_item, v_item ->> 'memberId') then raise exception 'MISSION_INVALID'; end if;
      insert into public.mission_assignments(room_id, member_id, slot, mission_id, difficulty, topic, target_member_id)
        values (p_room_id, (v_item ->> 'memberId')::uuid, v_slot::smallint, v_item ->> 'missionId', (v_item ->> 'difficulty')::smallint, v_item ->> 'topic',
                case when v_item ? 'targetMemberId' and jsonb_typeof(v_item -> 'targetMemberId') = 'string' then (v_item ->> 'targetMemberId')::uuid end);
    end loop;
  exception when unique_violation then
    raise exception 'MISSION_INVALID';
  end;
  -- every member holds exactly three slots whose difficulties match the chosen preset
  v_preset := public.mission_preset_difficulties(v_game.preset);
  if exists (select 1 from public.mission_assignments a where a.room_id = p_room_id group by a.member_id having count(*) <> 3 or array_agg(a.difficulty::integer order by a.difficulty) <> v_preset)
     or (select count(distinct member_id) from public.mission_assignments where room_id = p_room_id) <> v_n then
    raise exception 'MISSION_INVALID';
  end if;
  update public.mission_games set
    phase = 'mission',
    started_at = now(),
    ends_at = now() + make_interval(mins => v_game.duration_minutes),
    extensions = 0,
    reveal_order = p_reveal_order,
    reveal_cursor = 0,
    updated_at = now()
  where room_id = p_room_id;
  update public.group_rooms set status = 'playing', revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_status: achieve / unachieve / pass your own mission (no revision; idempotent).
-- mission and reveal_ready only; passed is final, swapped rows are never touched.
-- ---------------------------------------------------------------------------
create or replace function public.mission_set_status(p_room_id uuid, p_member_id uuid, p_assignment_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
  v_a public.mission_assignments;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'MISSION_PHASE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase not in ('mission', 'reveal_ready') then raise exception 'MISSION_PHASE'; end if;
  if p_status is null or p_status not in ('active', 'achieved', 'passed') then raise exception 'MISSION_INVALID'; end if;
  select * into v_a from public.mission_assignments where id = p_assignment_id and room_id = p_room_id for update;
  if not found or v_a.member_id <> p_member_id then raise exception 'FORBIDDEN'; end if;
  if v_a.status = p_status then return; end if;
  if (v_a.status = 'active' and p_status in ('achieved', 'passed')) or (v_a.status = 'achieved' and p_status = 'active') then
    update public.mission_assignments set status = p_status where id = v_a.id;
  else
    raise exception 'MISSION_UNAVAILABLE';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- swap: replace one of your own active missions with another of the same difficulty, once per game.
-- p_new = {missionId, difficulty, topic, targetMemberId}. The old row stays as 'swapped' so its id is never dealt again.
-- ---------------------------------------------------------------------------
create or replace function public.mission_swap(p_room_id uuid, p_member_id uuid, p_assignment_id uuid, p_new jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
  v_a public.mission_assignments;
  v_used integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'MISSION_PHASE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'mission' or v_game.ends_at <= now() then raise exception 'MISSION_PHASE'; end if;
  select * into v_a from public.mission_assignments where id = p_assignment_id and room_id = p_room_id for update;
  if not found or v_a.member_id <> p_member_id then raise exception 'FORBIDDEN'; end if;
  if v_a.status <> 'active' then raise exception 'MISSION_UNAVAILABLE'; end if;
  select used into v_used from public.mission_swaps where room_id = p_room_id and member_id = p_member_id for update;
  if coalesce(v_used, 0) >= 1 then raise exception 'MISSION_SWAP_LIMIT'; end if;
  if not public.mission_item_ok(p_room_id, p_new, p_member_id::text) then raise exception 'MISSION_INVALID'; end if;
  if (p_new ->> 'difficulty')::integer <> v_a.difficulty then raise exception 'MISSION_INVALID'; end if;
  begin
    update public.mission_assignments set status = 'swapped' where id = v_a.id;
    insert into public.mission_assignments(room_id, member_id, slot, mission_id, difficulty, topic, target_member_id)
      values (p_room_id, p_member_id, v_a.slot, p_new ->> 'missionId', v_a.difficulty, p_new ->> 'topic',
              case when p_new ? 'targetMemberId' and jsonb_typeof(p_new -> 'targetMemberId') = 'string' then (p_new ->> 'targetMemberId')::uuid end);
    insert into public.mission_swaps(room_id, member_id, used) values (p_room_id, p_member_id, 1)
      on conflict (room_id, member_id) do update set used = public.mission_swaps.used + 1;
  exception when unique_violation then
    -- the id was dealt meanwhile, or another member now chases the same topic on that person: the server draws again
    raise exception 'MISSION_POOL_EXHAUSTED';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- expire: mission -> reveal_ready once ends_at has passed. Idempotent: anything else is a no-op.
-- ---------------------------------------------------------------------------
create or replace function public.mission_expire(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'playing' then return; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'mission' or v_game.ends_at > now() then return; end if;
  update public.mission_games set phase = 'reveal_ready', updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- end_now: the host closes the mission phase early; ends_at becomes the real end (clamped so it never precedes started_at).
create or replace function public.mission_end_now(p_room_id uuid, p_member_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'MISSION_PHASE'; end if;
  if v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'mission' then raise exception 'MISSION_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'MISSION_NOT_OWNER'; end if;
  update public.mission_games set phase = 'reveal_ready', ends_at = least(ends_at, greatest(now(), started_at)), updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- extend: +15 minutes, at most twice, never beyond the room's own 24h expiry.
create or replace function public.mission_extend(p_room_id uuid, p_member_id uuid, p_minutes integer, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'MISSION_PHASE'; end if;
  if v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'mission' or v_game.ends_at <= now() then raise exception 'MISSION_PHASE'; end if;
  if not exists (select 1 from public.group_members where id = p_member_id and room_id = p_room_id and role = 'host') then raise exception 'MISSION_NOT_OWNER'; end if;
  if p_minutes is distinct from 15 then raise exception 'MISSION_INVALID'; end if;
  if v_game.extensions >= 2 then raise exception 'MISSION_EXTEND_LIMIT'; end if;
  if v_game.ends_at + interval '15 minutes' > v_room.expires_at then raise exception 'MISSION_UNAVAILABLE'; end if;
  update public.mission_games set ends_at = ends_at + interval '15 minutes', extensions = extensions + 1, updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- reveal_start: reveal_ready -> reveal. The host, or any member once 3 minutes passed since the real end time.
create or replace function public.mission_reveal_start(p_room_id uuid, p_member_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
  v_role text;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'MISSION_PHASE'; end if;
  if v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'reveal_ready' then raise exception 'MISSION_PHASE'; end if;
  select role into v_role from public.group_members where id = p_member_id and room_id = p_room_id;
  if v_role is null then raise exception 'FORBIDDEN'; end if;
  if v_role <> 'host' and now() < v_game.ends_at + interval '3 minutes' then raise exception 'MISSION_NOT_OWNER'; end if;
  -- from here only achieved missions are ever shown: unachieved / passed / swapped rows and the swap counters are erased now
  delete from public.mission_assignments where room_id = p_room_id and status <> 'achieved';
  delete from public.mission_swaps where room_id = p_room_id;
  update public.mission_games set phase = 'reveal', reveal_cursor = 0, updated_at = now() where room_id = p_room_id;
  update public.group_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

-- reveal_next: the host, or any member once 3 minutes passed since the real end time (same rule as reveal_start).
-- Past the last member the game is over: p_result (the summary the API built; see mission_summary_ok) is stored in mission_results
-- for 5 minutes, the whole mission_games row (assignments, swaps, reveal order) is deleted and the room ends (frees the host's room cap).
-- Before the last member p_result must be null.
create or replace function public.mission_reveal_next(p_room_id uuid, p_member_id uuid, p_expected_revision bigint, p_result jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
  v_total integer;
  v_role text;
  v_last boolean;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status <> 'playing' then raise exception 'MISSION_PHASE'; end if;
  if v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found or v_game.phase <> 'reveal' then raise exception 'MISSION_PHASE'; end if;
  select role into v_role from public.group_members where id = p_member_id and room_id = p_room_id;
  if v_role is null then raise exception 'FORBIDDEN'; end if;
  if v_role <> 'host' and now() < v_game.ends_at + interval '3 minutes' then raise exception 'MISSION_NOT_OWNER'; end if;
  v_total := jsonb_array_length(v_game.reveal_order);
  v_last := v_game.reveal_cursor + 1 >= v_total;
  if v_last then
    if not public.mission_summary_ok(p_room_id, p_result) then raise exception 'MISSION_INVALID'; end if;
    insert into public.mission_results(room_id, result, result_expires_at) values (p_room_id, p_result, now() + interval '5 minutes')
      on conflict (room_id) do update set result = excluded.result, result_expires_at = excluded.result_expires_at;
    -- removing the game row cascades assignments and swaps: nothing but the summary is left
    delete from public.mission_games where room_id = p_room_id;
  else
    if p_result is not null and jsonb_typeof(p_result) <> 'null' then raise exception 'MISSION_INVALID'; end if;
    update public.mission_games set reveal_cursor = v_game.reveal_cursor + 1, updated_at = now() where room_id = p_room_id;
  end if;
  update public.group_rooms set
    status = case when v_last then 'ended' else status end,
    revealed = false, revision = revision + 1, updated_at = now()
  where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- finish: host ends the game from lobby / mission / reveal. The whole game row (assignments, swaps) is erased and the room ends;
-- unlike a game played to the end, no summary is kept. A finished game's 5-minute summary cannot be cut short by anyone.
-- ---------------------------------------------------------------------------
create or replace function public.mission_finish(p_room_id uuid, p_member_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_game public.mission_games;
  v_role text;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.game_type <> 'mission_mingle' or v_room.expires_at <= now() or v_room.status not in ('lobby', 'playing') then raise exception 'MISSION_PHASE'; end if;
  if v_room.revision <> p_expected_revision then raise exception 'GROUP_STALE'; end if;
  select * into v_game from public.mission_games where room_id = p_room_id for update;
  if not found then raise exception 'MISSION_UNAVAILABLE'; end if;
  select role into v_role from public.group_members where id = p_member_id and room_id = p_room_id;
  if v_role is null then raise exception 'MISSION_NOT_OWNER'; end if;
  -- the host any time; anybody else during the reveal once 3 minutes passed since the real end time
  if v_role <> 'host' and (v_game.phase <> 'reveal' or now() < v_game.ends_at + interval '3 minutes') then raise exception 'MISSION_NOT_OWNER'; end if;
  -- removing the game row cascades assignments and swaps
  delete from public.mission_games where room_id = p_room_id;
  update public.group_rooms set status = 'ended', revealed = false, revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;

revoke all on function public.mission_create_room(uuid,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.mission_configure(uuid,uuid,jsonb,bigint) from public, anon, authenticated;
revoke all on function public.mission_start(uuid,uuid,jsonb,jsonb,bigint) from public, anon, authenticated;
revoke all on function public.mission_set_status(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.mission_swap(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.mission_expire(uuid) from public, anon, authenticated;
revoke all on function public.mission_end_now(uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.mission_extend(uuid,uuid,integer,bigint) from public, anon, authenticated;
revoke all on function public.mission_reveal_start(uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.mission_reveal_next(uuid,uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.mission_finish(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.mission_create_room(uuid,text,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.mission_configure(uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.mission_start(uuid,uuid,jsonb,jsonb,bigint) to service_role;
grant execute on function public.mission_set_status(uuid,uuid,uuid,text) to service_role;
grant execute on function public.mission_swap(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.mission_expire(uuid) to service_role;
grant execute on function public.mission_end_now(uuid,uuid,bigint) to service_role;
grant execute on function public.mission_extend(uuid,uuid,integer,bigint) to service_role;
grant execute on function public.mission_reveal_start(uuid,uuid,bigint) to service_role;
grant execute on function public.mission_reveal_next(uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.mission_finish(uuid,uuid,bigint) to service_role;

commit;
