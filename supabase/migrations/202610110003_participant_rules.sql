-- Participant-count metadata for new group rooms.
-- Legacy rows without metadata remain ordinary group rooms (2-8 members).
begin;

alter table public.group_rooms add column if not exists participant_rule text not null default 'group';
alter table public.group_rooms drop constraint if exists group_rooms_participant_rule;
alter table public.group_rooms add constraint group_rooms_participant_rule
  check (participant_rule in ('pair', 'group'));

drop function if exists public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz,boolean);
create or replace function public.group_create_room(
  p_host_user_id uuid, p_invite_hash text, p_deck_id text, p_deck_name text, p_cards jsonb,
  p_adult_only boolean, p_host_secret_hash text, p_host_name text, p_expires_at timestamptz,
  p_adult_attested boolean default false
) returns table(room_id uuid, host_member_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_room uuid;
  v_member uuid;
  v_adult boolean := coalesce(p_adult_only, false);
  v_rule text := 'group';
begin
  if v_adult and not public.is_adult_confirmed(p_host_user_id) then raise exception 'AGE_CONFIRMATION_REQUIRED'; end if;
  if v_adult and coalesce(p_adult_attested, false) is not true then raise exception 'ADULT_ATTESTATION_REQUIRED'; end if;
  if jsonb_typeof(p_cards) <> 'array' then raise exception 'INVALID_REQUEST'; end if;
  if exists (select 1 from jsonb_array_elements(p_cards) item where item ? 'participantRule' and item->>'participantRule' not in ('pair', 'group')) then
    raise exception 'INVALID_PARTICIPANT_RULE';
  end if;
  if exists (select 1 from jsonb_array_elements(p_cards) item where item->>'participantRule' = 'pair') then v_rule := 'pair'; end if;
  insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only, member_count, expires_at, adult_attested_at, participant_rule)
    values (p_host_user_id, p_invite_hash, p_deck_id, p_deck_name, p_cards, v_adult, 1, p_expires_at, case when v_adult then now() end, v_rule)
    returning id into v_room;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed, age_confirmed_at)
    values (v_room, p_host_secret_hash, left(p_host_name, 40), 'host', true, case when v_adult then now() end)
    returning id into v_member;
  return query select v_room, v_member;
end; $$;
revoke all on function public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz,boolean) to service_role;

drop function if exists public.group_join_member(uuid,text,text,boolean,boolean);
create or replace function public.group_join_member(
  p_room_id uuid, p_secret_hash text, p_display_name text, p_adult_confirmed boolean,
  p_age_confirmed boolean default false
) returns public.group_members
language plpgsql security definer set search_path = public as $$
declare
  v_room public.group_rooms;
  v_member public.group_members;
  v_limit integer;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.expires_at <= now() then raise exception 'GROUP_EXPIRED'; end if;
  select * into v_member from public.group_members where room_id = p_room_id and secret_hash = p_secret_hash;
  if found then return v_member; end if;
  if v_room.status <> 'lobby' then raise exception 'GROUP_ALREADY_STARTED'; end if;
  if v_room.adult_only and coalesce(p_age_confirmed, false) is not true then raise exception 'PARTICIPANT_AGE_REQUIRED'; end if;
  if v_room.adult_only and coalesce(p_adult_confirmed, false) is not true then raise exception 'ADULT_CONSENT_REQUIRED'; end if;
  v_limit := case when coalesce(v_room.participant_rule, 'group') = 'pair' then 2 else 8 end;
  if v_room.member_count >= v_limit then raise exception 'GROUP_FULL'; end if;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed, age_confirmed_at)
    values (p_room_id, p_secret_hash, p_display_name, 'guest', coalesce(p_adult_confirmed, false), case when coalesce(p_age_confirmed, false) then now() end)
    returning * into v_member;
  update public.group_rooms set member_count = member_count + 1, revision = revision + 1, updated_at = now() where id = p_room_id;
  return v_member;
end; $$;
revoke all on function public.group_join_member(uuid,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.group_join_member(uuid,text,text,boolean,boolean) to service_role;

commit;
