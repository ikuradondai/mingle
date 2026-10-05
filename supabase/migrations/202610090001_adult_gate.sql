-- R18 age-confirmation gate.
-- Apply after 202610020001_accounts.sql, 202610070001_venues.sql and 202610080001_group_rooms.sql,
-- and BEFORE deploying the application code that sends the new RPC arguments.
begin;

-- ===== 1. Account-level adult (18+) self-confirmation =====
-- Absence of a row (or NULL) means "not confirmed". Writes only via set_adult_confirmation().
create table if not exists public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  adult_confirmed_at timestamptz null,
  adult_confirmation_source text null check (adult_confirmation_source in ('login_screen', 'settings')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_profiles_adult_pair check ((adult_confirmed_at is null) = (adult_confirmation_source is null))
);
alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from anon, authenticated;
grant select on public.account_profiles to authenticated;
grant all on public.account_profiles to service_role;
drop policy if exists account_profiles_owner_select on public.account_profiles;
create policy account_profiles_owner_select on public.account_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.set_adult_confirmation(p_confirmed boolean, p_source text default 'settings')
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_at timestamptz;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if p_confirmed is null or (p_confirmed and (p_source is null or p_source not in ('login_screen', 'settings'))) then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  -- Revoking deletes the row: no history (confirmation time, revocation time) is kept.
  if not p_confirmed then
    delete from public.account_profiles where user_id = v_user;
    return null;
  end if;
  insert into public.account_profiles as p (user_id, adult_confirmed_at, adult_confirmation_source)
  values (v_user, now(), p_source)
  on conflict (user_id) do update set
    adult_confirmed_at = coalesce(p.adult_confirmed_at, now()),
    adult_confirmation_source = coalesce(p.adult_confirmation_source, excluded.adult_confirmation_source),
    updated_at = now()
  returning p.adult_confirmed_at into v_at;
  return v_at;
end; $$;
revoke all on function public.set_adult_confirmation(boolean, text) from public, anon;
grant execute on function public.set_adult_confirmation(boolean, text) to authenticated;

create or replace function public.is_adult_confirmed(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.account_profiles where user_id = p_user_id and adult_confirmed_at is not null);
$$;
revoke all on function public.is_adult_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.is_adult_confirmed(uuid) to service_role;

-- ===== 2. Group rooms: host attestation + per-member age tap =====
alter table public.group_rooms add column if not exists adult_attested_at timestamptz null;
alter table public.group_members add column if not exists age_confirmed_at timestamptz null;
-- Pre-gate R18 rooms have no host attestation and there are no users yet: remove them (members cascade).
-- Idempotent: after the first run no such rows remain.
delete from public.group_members where room_id in (select id from public.group_rooms where adult_only and adult_attested_at is null);
delete from public.group_rooms where adult_only and adult_attested_at is null;
alter table public.group_rooms drop constraint if exists group_rooms_adult_attested;
alter table public.group_rooms add constraint group_rooms_adult_attested
  check (not adult_only or adult_attested_at is not null);

drop function if exists public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz);
create or replace function public.group_create_room(
  p_host_user_id uuid, p_invite_hash text, p_deck_id text, p_deck_name text, p_cards jsonb,
  p_adult_only boolean, p_host_secret_hash text, p_host_name text, p_expires_at timestamptz,
  p_adult_attested boolean default false
) returns table(room_id uuid, host_member_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_room uuid; v_member uuid; v_adult boolean := coalesce(p_adult_only, false);
begin
  if v_adult and not public.is_adult_confirmed(p_host_user_id) then raise exception 'AGE_CONFIRMATION_REQUIRED'; end if;
  if v_adult and coalesce(p_adult_attested, false) is not true then raise exception 'ADULT_ATTESTATION_REQUIRED'; end if;
  insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only, member_count, expires_at, adult_attested_at)
    values (p_host_user_id, p_invite_hash, p_deck_id, p_deck_name, p_cards, v_adult, 1, p_expires_at, case when v_adult then now() end)
    returning id into v_room;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed, age_confirmed_at)
    values (v_room, p_host_secret_hash, left(p_host_name, 40), 'host', true, case when v_adult then now() end)
    returning id into v_member;
  return query select v_room, v_member;
end; $$;
revoke all on function public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz,boolean) to service_role;

drop function if exists public.group_join_member(uuid,text,text,boolean);
create or replace function public.group_join_member(
  p_room_id uuid, p_secret_hash text, p_display_name text, p_adult_confirmed boolean, p_age_confirmed boolean default false
) returns public.group_members
language plpgsql security definer set search_path = public as $$
declare v_room public.group_rooms; v_member public.group_members;
begin
  select * into v_member from public.group_members where room_id = p_room_id and secret_hash = p_secret_hash;
  if found then return v_member; end if;
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.expires_at <= now() then raise exception 'GROUP_EXPIRED'; end if;
  if v_room.status <> 'lobby' then raise exception 'GROUP_ALREADY_STARTED'; end if;
  if v_room.adult_only and coalesce(p_age_confirmed, false) is not true then raise exception 'PARTICIPANT_AGE_REQUIRED'; end if;
  if v_room.adult_only and coalesce(p_adult_confirmed, false) is not true then raise exception 'ADULT_CONSENT_REQUIRED'; end if;
  if v_room.member_count >= 8 then raise exception 'GROUP_FULL'; end if;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed, age_confirmed_at)
    values (p_room_id, p_secret_hash, p_display_name, 'guest', coalesce(p_adult_confirmed, false),
            case when coalesce(p_age_confirmed, false) then now() end)
    returning * into v_member;
  update public.group_rooms set member_count = member_count + 1, revision = revision + 1, updated_at = now() where id = p_room_id;
  return v_member;
end; $$;
revoke all on function public.group_join_member(uuid,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.group_join_member(uuid,text,text,boolean,boolean) to service_role;

-- ===== 3. Venues: owner attestation when enabling R18 =====
alter table public.venues add column if not exists adult_attested_at timestamptz null;
alter table public.venues add column if not exists adult_attested_by uuid null references auth.users(id) on delete set null;
-- Pre-existing R18 venues have no attestation: switch them off; owners re-enable with attestation.
update public.venues set adult_enabled = false where adult_enabled and adult_attested_at is null;

create or replace function public.venues_adult_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_turning_on boolean;
begin
  if new.adult_enabled then
    if tg_op = 'INSERT' then
      v_turning_on := true;
    else
      v_turning_on := not old.adult_enabled;
    end if;
    if v_turning_on then
      if not public.is_adult_confirmed(new.owner_id) then raise exception 'AGE_CONFIRMATION_REQUIRED'; end if;
      new.adult_attested_at := now();
      new.adult_attested_by := new.owner_id;
    else
      new.adult_attested_at := old.adult_attested_at;   -- not client-writable
      new.adult_attested_by := old.adult_attested_by;
    end if;
  else
    new.adult_attested_at := null;
    new.adult_attested_by := null;
  end if;
  return new;
end; $$;
drop trigger if exists venues_adult_guard on public.venues;
create trigger venues_adult_guard before insert or update on public.venues
  for each row execute function public.venues_adult_guard();

commit;
