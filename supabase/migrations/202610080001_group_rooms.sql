begin;

create table if not exists public.group_rooms (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  invite_hash text not null unique,
  deck_id text not null,
  deck_name text not null,
  cards jsonb not null check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) between 6 and 40),
  adult_only boolean not null default false,
  status text not null default 'lobby' check (status in ('lobby','playing','break','ended')),
  member_count integer not null default 0 check (member_count between 0 and 8),
  cursor integer not null default 0 check (cursor >= 0 and cursor <= jsonb_array_length(cards)),
  revealed boolean not null default false,
  answer_index integer not null default 0 check (answer_index >= 0 and answer_index < 8),
  revision bigint not null default 0 check (revision >= 0),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.group_rooms(id) on delete cascade,
  secret_hash text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null default 'guest' check (role in ('host','guest')),
  adult_confirmed boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.group_rooms enable row level security;
alter table public.group_members enable row level security;
revoke all on public.group_rooms, public.group_members from anon, authenticated;
grant all on public.group_rooms, public.group_members to service_role;

create index if not exists group_rooms_host_expires_idx on public.group_rooms(host_user_id, expires_at);
create index if not exists group_members_room_idx on public.group_members(room_id);
create unique index if not exists group_members_one_host_idx on public.group_members(room_id) where role = 'host';

-- Joining is serialized on the room row so two QR scans cannot exceed eight members.
create or replace function public.group_join_member(
  p_room_id uuid,
  p_secret_hash text,
  p_display_name text,
  p_adult_confirmed boolean
) returns public.group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.group_rooms;
  v_member public.group_members;
begin
  select * into v_room from public.group_rooms where id = p_room_id for update;
  if not found or v_room.expires_at <= now() then raise exception 'GROUP_EXPIRED'; end if;
  select * into v_member from public.group_members where room_id = p_room_id and secret_hash = p_secret_hash;
  if found then return v_member; end if;
  if v_room.status <> 'lobby' then raise exception 'GROUP_ALREADY_STARTED'; end if;
  if v_room.adult_only and coalesce(p_adult_confirmed, false) is not true then raise exception 'ADULT_CONSENT_REQUIRED'; end if;
  if v_room.member_count >= 8 then raise exception 'GROUP_FULL'; end if;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed)
    values (p_room_id, p_secret_hash, p_display_name, 'guest', coalesce(p_adult_confirmed, false))
    returning * into v_member;
  update public.group_rooms set member_count = member_count + 1, revision = revision + 1, updated_at = now() where id = p_room_id;
  return v_member;
end;
$$;
revoke all on function public.group_join_member(uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.group_join_member(uuid,text,text,boolean) to service_role;

create or replace function public.group_create_room(
  p_host_user_id uuid,
  p_invite_hash text,
  p_deck_id text,
  p_deck_name text,
  p_cards jsonb,
  p_adult_only boolean,
  p_host_secret_hash text,
  p_host_name text,
  p_expires_at timestamptz
) returns table(room_id uuid, host_member_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_member uuid;
begin
  insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only, member_count, expires_at)
    values (p_host_user_id, p_invite_hash, p_deck_id, p_deck_name, p_cards, coalesce(p_adult_only,false), 1, p_expires_at)
    returning id into v_room;
  insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed)
    values (v_room, p_host_secret_hash, left(p_host_name,40), 'host', true)
    returning id into v_member;
  return query select v_room, v_member;
exception when others then raise;
end;
$$;
revoke all on function public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz) to service_role;

commit;
