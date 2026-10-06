begin;

create table if not exists public.line_delivery_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.line_delivery_settings(id, enabled) values (true, false) on conflict (id) do nothing;

create table if not exists public.persistent_groups (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  source_deck_id text not null check (char_length(btrim(source_deck_id)) between 1 and 80),
  source_deck_name text not null check (char_length(btrim(source_deck_name)) between 1 and 120),
  timezone text not null default 'Asia/Tokyo' check (char_length(timezone) between 1 and 80),
  delivery_time time not null default '09:00',
  status text not null default 'active' check (status in ('active','paused')),
  next_run_at timestamptz not null default (now() + interval '1 day'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.persistent_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.persistent_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  status text not null default 'active' check (status in ('active','paused','left')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  line_opt_in boolean not null default false,
  stop_reason text null check (stop_reason is null or stop_reason in ('user','blocked','unlinked','operator')),
  joined_at timestamptz not null default now(), left_at timestamptz null, updated_at timestamptz not null default now(),
  unique(group_id,user_id)
);
create unique index if not exists persistent_group_one_owner_idx on public.persistent_group_members(group_id) where role='owner' and status<>'left';
create index if not exists persistent_group_members_user_idx on public.persistent_group_members(user_id,status);

create or replace function public.persistent_next_run(p_timezone text,p_delivery_time time,p_now timestamptz default now())
returns timestamptz language plpgsql immutable as $$
declare local_now timestamp; local_target timestamp;
begin
  local_now := p_now at time zone p_timezone;
  local_target := date_trunc('day',local_now) + p_delivery_time;
  if local_target <= local_now then local_target := local_target + interval '1 day'; end if;
  return local_target at time zone p_timezone;
end $$;
create table if not exists public.persistent_group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.persistent_groups(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) between 32 and 128),
  expires_at timestamptz not null, revoked_at timestamptz null,
  created_by uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now()
);
create table if not exists public.line_account_links (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
  line_user_id text not null unique check (char_length(line_user_id) between 20 and 64),
  status text not null default 'active' check (status in ('active','unlinked','blocked')),
  delivery_paused boolean not null default false,
  linked_at timestamptz not null default now(), stopped_at timestamptz null, updated_at timestamptz not null default now()
);
alter table public.line_account_links add column if not exists delivery_paused boolean not null default false;
create table if not exists public.line_link_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid null references auth.users(id) on delete cascade,
  expected_line_user_id text not null check (char_length(expected_line_user_id) between 20 and 64),
  line_link_token_hash text null unique check (line_link_token_hash is null or char_length(line_link_token_hash) between 32 and 128),
  nonce_hash text null unique check (nonce_hash is null or char_length(nonce_hash) between 32 and 128),
  setup_token_hash text not null unique check (char_length(setup_token_hash) between 32 and 128),
  expires_at timestamptz not null, consumed_at timestamptz null, created_at timestamptz not null default now()
);
create index if not exists line_link_attempts_user_idx on public.line_link_attempts(user_id,expires_at);
create table if not exists public.line_webhook_events (
  event_id text primary key check (char_length(event_id) between 20 and 128),
  event_type text not null check (char_length(event_type) between 1 and 80),
  line_user_id text null, received_at timestamptz not null default now(), processed_at timestamptz null
);
create table if not exists public.daily_questions (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.persistent_groups(id) on delete cascade,
  local_date date not null, source_deck_id text not null, question_id text not null,
  question_text text not null check (char_length(btrim(question_text)) between 1 and 1000),
  payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(group_id,local_date)
);
create table if not exists public.daily_deliveries (
  id uuid primary key default gen_random_uuid(), daily_question_id uuid not null references public.daily_questions(id) on delete cascade,
  group_id uuid not null references public.persistent_groups(id) on delete cascade,
  member_id uuid not null references public.persistent_group_members(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  line_user_id text not null check (char_length(line_user_id) between 20 and 64),
  payload jsonb not null, retry_key uuid not null unique, lease_token uuid null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','unknown','stopped')),
  attempt_count integer not null default 0 check (attempt_count>=0), first_attempt_at timestamptz null,
  next_attempt_at timestamptz not null default now(), max_attempts integer not null default 5 check(max_attempts between 1 and 20),
  lease_until timestamptz null, sent_at timestamptz null, last_error text null check(last_error is null or char_length(last_error)<=500),
  request_id text null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(daily_question_id,member_id)
);
create index if not exists daily_deliveries_claim_idx on public.daily_deliveries(status,lease_until,first_attempt_at);

alter table public.line_link_attempts add column if not exists line_link_token_hash text;
alter table public.daily_deliveries add column if not exists next_attempt_at timestamptz;
alter table public.daily_deliveries add column if not exists max_attempts integer;
update public.daily_deliveries set next_attempt_at=coalesce(next_attempt_at,created_at,now()), max_attempts=coalesce(max_attempts,5);
alter table public.daily_deliveries alter column next_attempt_at set default now();
alter table public.daily_deliveries alter column next_attempt_at set not null;
alter table public.daily_deliveries alter column max_attempts set default 5;
alter table public.daily_deliveries alter column max_attempts set not null;
create table if not exists public.daily_checkins (
  daily_question_id uuid not null references public.daily_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_id uuid null references public.daily_deliveries(id) on delete set null,
  checked_at timestamptz not null default now(), primary key(daily_question_id,user_id)
);
alter table public.daily_checkins add column if not exists daily_question_id uuid;
alter table public.daily_checkins alter column delivery_id drop not null;
update public.daily_checkins c set daily_question_id=d.daily_question_id from public.daily_deliveries d where d.id=c.delivery_id and c.daily_question_id is null;
alter table public.daily_checkins alter column daily_question_id set not null;
do $$ begin
  if exists(select 1 from pg_constraint where conrelid='public.daily_checkins'::regclass and conname='daily_checkins_pkey') then alter table public.daily_checkins drop constraint daily_checkins_pkey; end if;
  begin alter table public.daily_checkins add primary key(daily_question_id,user_id); exception when duplicate_object then null; end;
end $$;
create unique index if not exists daily_checkins_question_user_idx on public.daily_checkins(daily_question_id,user_id);

create or replace function public.line_set_delivery_paused(p_user_id uuid,p_paused boolean)
returns public.line_account_links language plpgsql security definer set search_path=public as $$
declare l public.line_account_links;
begin
  select * into l from public.line_account_links where user_id=p_user_id for update;
  if not found or l.status<>'active' then raise exception 'LINE_NOT_LINKED'; end if;
  update public.line_account_links set delivery_paused=p_paused,stopped_at=case when p_paused then now() else null end,updated_at=now() where id=l.id returning * into l;
  if p_paused then update public.daily_deliveries set status='stopped',updated_at=now() where user_id=p_user_id and status in('pending','sending','unknown'); end if;
  return l;
end $$;

revoke all on function public.line_set_delivery_paused(uuid,boolean) from public,anon,authenticated;
grant execute on function public.line_set_delivery_paused(uuid,boolean) to service_role;

do $$
declare t text;
begin
  foreach t in array array['line_delivery_settings','persistent_groups','persistent_group_members','persistent_group_invites','line_account_links','line_link_attempts','line_webhook_events','daily_questions','daily_deliveries','daily_checkins'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create or replace function public.persistent_group_create(p_owner_user_id uuid,p_name text,p_source_deck_id text,p_source_deck_name text,p_timezone text default 'Asia/Tokyo',p_delivery_time time default '09:00')
returns public.persistent_groups language plpgsql security definer set search_path=public as $$
declare g public.persistent_groups; next_run timestamptz;
begin
  perform 1 from auth.users where id=p_owner_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if (select count(*) from public.persistent_groups where owner_user_id=p_owner_user_id)>=5 then raise exception 'PERSISTENT_GROUP_LIMIT'; end if;
  begin perform now() at time zone p_timezone; exception when others then raise exception 'INVALID_TIMEZONE'; end;
  next_run := public.persistent_next_run(p_timezone,p_delivery_time);
  insert into public.persistent_groups(owner_user_id,name,source_deck_id,source_deck_name,timezone,delivery_time)
    values(p_owner_user_id,btrim(p_name),btrim(p_source_deck_id),btrim(p_source_deck_name),p_timezone,p_delivery_time) returning * into g;
  update public.persistent_groups set next_run_at=next_run where id=g.id returning * into g;
  insert into public.persistent_group_members(group_id,user_id,role,display_name) values(g.id,p_owner_user_id,'owner','代表者');
  return g;
end $$;

create or replace function public.persistent_group_create_invite(p_group_id uuid,p_owner_user_id uuid,p_token_hash text,p_expires_at timestamptz)
returns public.persistent_group_invites language plpgsql security definer set search_path=public as $$
declare i public.persistent_group_invites;
begin
  if not exists(select 1 from public.persistent_groups where id=p_group_id and owner_user_id=p_owner_user_id) then raise exception 'FORBIDDEN'; end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '7 days' then raise exception 'INVALID_INVITE_EXPIRY'; end if;
  insert into public.persistent_group_invites(group_id,token_hash,expires_at,created_by) values(p_group_id,p_token_hash,p_expires_at,p_owner_user_id) returning * into i;
  return i;
end $$;

create or replace function public.persistent_group_revoke_invites(p_group_id uuid,p_owner_user_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if not exists(select 1 from public.persistent_groups where id=p_group_id and owner_user_id=p_owner_user_id) then raise exception 'FORBIDDEN'; end if;
  update public.persistent_group_invites set revoked_at=now() where group_id=p_group_id and revoked_at is null and expires_at>now();
  get diagnostics changed=row_count; return changed;
end $$;

create or replace function public.persistent_group_accept_invite(p_token_hash text,p_user_id uuid,p_display_name text)
returns public.persistent_group_members language plpgsql security definer set search_path=public as $$
declare i public.persistent_group_invites; g public.persistent_groups; m public.persistent_group_members;
begin
  select * into i from public.persistent_group_invites where token_hash=p_token_hash and revoked_at is null for update;
  if not found or i.expires_at<=now() then raise exception 'INVITE_EXPIRED'; end if;
  select * into g from public.persistent_groups where id=i.group_id for update;
  if g.status<>'active' then raise exception 'GROUP_PAUSED'; end if;
  perform 1 from auth.users where id=p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  select * into m from public.persistent_group_members where group_id=g.id and user_id=p_user_id;
  if found then
    if m.status='left' then
      if (select count(*) from public.persistent_group_members where user_id=p_user_id and status<>'left')>=20 then raise exception 'MEMBERSHIP_LIMIT'; end if;
      if (select count(*) from public.persistent_group_members where group_id=g.id and status<>'left')>=8 then raise exception 'GROUP_FULL'; end if;
      update public.persistent_group_members set status='active',left_at=null,display_name=btrim(p_display_name),updated_at=now() where id=m.id returning * into m;
    end if;
    return m;
  end if;
  if (select count(*) from public.persistent_group_members where user_id=p_user_id and status<>'left')>=20 then raise exception 'MEMBERSHIP_LIMIT'; end if;
  if (select count(*) from public.persistent_group_members where group_id=g.id and status<>'left')>=8 then raise exception 'GROUP_FULL'; end if;
  insert into public.persistent_group_members(group_id,user_id,display_name) values(g.id,p_user_id,btrim(p_display_name)) returning * into m;
  return m;
end $$;

create or replace function public.persistent_group_set_member_status(p_group_id uuid,p_actor_user_id uuid,p_member_user_id uuid,p_status text)
returns public.persistent_group_members language plpgsql security definer set search_path=public as $$
declare m public.persistent_group_members; owner_ok boolean;
begin
  if p_status not in('active','paused','left') then raise exception 'INVALID_MEMBER_STATUS'; end if;
  select exists(select 1 from public.persistent_groups where id=p_group_id and owner_user_id=p_actor_user_id) into owner_ok;
  if not owner_ok and p_actor_user_id<>p_member_user_id then raise exception 'FORBIDDEN'; end if;
  if owner_ok and p_actor_user_id<>p_member_user_id and p_status<>'left' then raise exception 'OWNER_CANNOT_RESUME_MEMBER'; end if;
  select * into m from public.persistent_group_members where group_id=p_group_id and user_id=p_member_user_id for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if m.role='owner' and p_status='left' then raise exception 'OWNER_TRANSFER_REQUIRED'; end if;
  if m.status='left' then raise exception 'REJOIN_INVITE_REQUIRED'; end if;
  update public.persistent_group_members set status=p_status,left_at=case when p_status='left' then now() else null end,line_opt_in=case when p_status='left' then false else line_opt_in end,updated_at=now() where id=m.id returning * into m;
  if p_status in('paused','left') then
    update public.daily_deliveries set status='stopped',lease_until=null,lease_token=null,next_attempt_at=now(),updated_at=now()
      where member_id=m.id and status in('pending','sending','unknown');
  end if;
  return m;
end $$;

create or replace function public.persistent_group_set_status(p_group_id uuid,p_owner_user_id uuid,p_status text,p_next_run_at timestamptz default null)
returns public.persistent_groups language plpgsql security definer set search_path=public as $$
declare g public.persistent_groups;
begin
  if p_status not in('active','paused') then raise exception 'INVALID_GROUP_STATUS'; end if;
  if not exists(select 1 from public.persistent_groups where id=p_group_id and owner_user_id=p_owner_user_id) then raise exception 'FORBIDDEN'; end if;
  update public.persistent_groups set status=p_status,next_run_at=case when p_status='active' then coalesce(p_next_run_at,public.persistent_next_run(timezone,delivery_time)) else next_run_at end,updated_at=now() where id=p_group_id returning * into g;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if p_status='paused' then
    update public.daily_deliveries set status='stopped',lease_until=null,lease_token=null,next_attempt_at=now(),updated_at=now()
      where group_id=p_group_id and status in('pending','sending','unknown');
  end if;
  return g;
end $$;

create or replace function public.persistent_group_advance_run(p_group_id uuid,p_expected_run_at timestamptz)
returns public.persistent_groups language plpgsql security definer set search_path=public as $$
declare g public.persistent_groups;
begin
  select * into g from public.persistent_groups where id=p_group_id and status='active' for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if g.next_run_at is distinct from p_expected_run_at then return g; end if;
  update public.persistent_groups set next_run_at=public.persistent_next_run(timezone,delivery_time, greatest(coalesce(next_run_at,now()),now())),updated_at=now() where id=g.id returning * into g;
  return g;
end $$;

create or replace function public.persistent_group_set_line_opt_in(p_group_id uuid,p_user_id uuid,p_enabled boolean)
returns public.persistent_group_members language plpgsql security definer set search_path=public as $$
declare m public.persistent_group_members;
begin
  update public.persistent_group_members set line_opt_in=coalesce(p_enabled,false),stop_reason=case when coalesce(p_enabled,false) then null else 'user' end,updated_at=now() where group_id=p_group_id and user_id=p_user_id and status='active' returning * into m;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if not coalesce(p_enabled,false) then
    update public.daily_deliveries set status='stopped',lease_until=null,lease_token=null,next_attempt_at=now(),updated_at=now()
      where member_id=m.id and status in('pending','sending','unknown');
  end if;
  return m;
end $$;

create or replace function public.line_create_link_attempt(p_expected_line_user_id text,p_line_link_token_hash text,p_setup_token_hash text,p_expires_at timestamptz,p_user_id uuid default null)
returns public.line_link_attempts language plpgsql security definer set search_path=public as $$
declare a public.line_link_attempts;
begin
  if p_user_id is not null then raise exception 'LINK_AUTH_BIND_REQUIRED'; end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '10 minutes' then raise exception 'INVALID_LINK_EXPIRY'; end if;
  if exists(select 1 from public.line_account_links where line_user_id=p_expected_line_user_id and (p_user_id is null or user_id<>p_user_id) and status<>'unlinked') then raise exception 'LINE_ID_ALREADY_LINKED'; end if;
  insert into public.line_link_attempts(user_id,expected_line_user_id,line_link_token_hash,setup_token_hash,expires_at) values(p_user_id,p_expected_line_user_id,p_line_link_token_hash,p_setup_token_hash,p_expires_at) returning * into a;
  return a;
end $$;

create or replace function public.line_bind_link_attempt(p_setup_token_hash text,p_user_id uuid,p_nonce_hash text,p_line_link_token_hash text)
returns public.line_link_attempts language plpgsql security definer set search_path=public as $$
declare a public.line_link_attempts;
begin
  select * into a from public.line_link_attempts where setup_token_hash=p_setup_token_hash and user_id is null for update;
  if not found or a.consumed_at is not null or a.expires_at<=now() or a.line_link_token_hash is null or a.line_link_token_hash<>p_line_link_token_hash then raise exception 'LINK_ATTEMPT_INVALID'; end if;
  update public.line_link_attempts set user_id=p_user_id,nonce_hash=p_nonce_hash where id=a.id returning * into a;
  return a;
end $$;


create or replace function public.line_consume_account_link(p_nonce_hash text,p_line_user_id text)
returns public.line_account_links language plpgsql security definer set search_path=public as $$
declare a public.line_link_attempts; l public.line_account_links;
begin
  select * into a from public.line_link_attempts where nonce_hash=p_nonce_hash for update;
  if not found or a.user_id is null or a.consumed_at is not null or a.expires_at<=now() then raise exception 'LINK_ATTEMPT_INVALID'; end if;
  if a.expected_line_user_id<>p_line_user_id then raise exception 'LINE_ID_MISMATCH'; end if;
  select * into l from public.line_account_links where line_user_id=p_line_user_id for update;
  if found and l.user_id<>a.user_id and l.status<>'unlinked' then raise exception 'LINE_ID_ALREADY_LINKED'; end if;
  if found and l.user_id<>a.user_id and l.status='unlinked' then
    delete from public.line_account_links where id=l.id;
  end if;
  insert into public.line_account_links(user_id,line_user_id,status,stopped_at) values(a.user_id,p_line_user_id,'active',null)
    on conflict(user_id) do update set line_user_id=excluded.line_user_id,status='active',stopped_at=null,updated_at=now() returning * into l;
  update public.line_link_attempts set consumed_at=now() where id=a.id;
  return l;
end $$;

create or replace function public.line_set_link_status(p_user_id uuid,p_line_user_id text,p_status text)
returns public.line_account_links language plpgsql security definer set search_path=public as $$
declare l public.line_account_links;
begin
  if p_status not in('active','unlinked','blocked') then raise exception 'INVALID_LINK_STATUS'; end if;
  update public.line_account_links set status=p_status,delivery_paused=case when p_status='active' then false else true end,stopped_at=case when p_status='active' then null else now() end,updated_at=now() where user_id=p_user_id and line_user_id=p_line_user_id returning * into l;
  if not found then raise exception 'LINE_LINK_NOT_FOUND'; end if;
  if p_status<>'active' then
    update public.persistent_group_members set line_opt_in=false,stop_reason=case when p_status='blocked' then 'blocked' else 'unlinked' end,updated_at=now() where user_id=p_user_id;
    update public.daily_deliveries set status='stopped',lease_until=null,lease_token=null,next_attempt_at=now(),updated_at=now()
      where user_id=p_user_id and status in('pending','sending','unknown');
  end if;
  return l;
end $$;

create or replace function public.line_record_webhook_event(p_event_id text,p_event_type text,p_line_user_id text,p_payload jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare inserted_count integer;
begin
  insert into public.line_webhook_events(event_id,event_type,line_user_id,processed_at) values(p_event_id,p_event_type,p_line_user_id,now()) on conflict(event_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count=0 then return false; end if;
  if p_event_type='unfollow' then
    update public.line_account_links set status='blocked',delivery_paused=true,stopped_at=now(),updated_at=now() where line_user_id=p_line_user_id;
    update public.daily_deliveries set status='stopped',lease_until=null,lease_token=null,next_attempt_at=now(),updated_at=now()
      where line_user_id=p_line_user_id and status in('pending','sending','unknown');
  elsif p_event_type='stop' then
    update public.line_account_links set delivery_paused=true,stopped_at=now(),updated_at=now() where line_user_id=p_line_user_id;
    update public.daily_deliveries set status='stopped',lease_until=null,lease_token=null,next_attempt_at=now(),updated_at=now()
      where line_user_id=p_line_user_id and status in('pending','sending','unknown');
  elsif p_event_type='resume' then
    update public.line_account_links set delivery_paused=false,stopped_at=null,updated_at=now() where line_user_id=p_line_user_id and status='active';
  end if;
  return true;
end $$;

create or replace function public.line_record_account_link_event(p_event_id text,p_line_user_id text,p_nonce_hash text,p_result text)
returns public.line_account_links language plpgsql security definer set search_path=public as $$
declare inserted_count integer; linked public.line_account_links;
begin
  insert into public.line_webhook_events(event_id,event_type,line_user_id,processed_at) values(p_event_id,'account_link',p_line_user_id,now()) on conflict(event_id) do nothing;
  get diagnostics inserted_count=row_count;
  if inserted_count=0 then return null; end if;
  if lower(coalesce(p_result,''))<>'ok' then raise exception 'LINK_ATTEMPT_INVALID'; end if;
  linked := public.line_consume_account_link(p_nonce_hash,p_line_user_id);
  return linked;
end $$;

create or replace function public.daily_prepare_question(p_group_id uuid,p_local_date date,p_source_deck_id text,p_question_id text,p_question_text text,p_payload jsonb default '{}'::jsonb)
returns public.daily_questions language plpgsql security definer set search_path=public as $$
declare g public.persistent_groups; q public.daily_questions; is_new boolean := false;
begin
  select * into g from public.persistent_groups where id=p_group_id for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if g.status<>'active' then raise exception 'GROUP_PAUSED'; end if;
  if p_question_text is null or btrim(p_question_text)='' then raise exception 'INVALID_QUESTION'; end if;
  select * into q from public.daily_questions where group_id=p_group_id and local_date=p_local_date;
  if found and (q.question_id<>p_question_id or q.question_text<>p_question_text) then raise exception 'DAILY_QUESTION_FINALIZED'; end if;
  if not found then insert into public.daily_questions(group_id,local_date,source_deck_id,question_id,question_text,payload) values(p_group_id,p_local_date,p_source_deck_id,p_question_id,p_question_text,coalesce(p_payload,'{}'::jsonb)) returning * into q; is_new := true; end if;
  if is_new then insert into public.daily_deliveries(daily_question_id,group_id,member_id,user_id,line_user_id,payload,retry_key)
    select q.id,g.id,m.id,m.user_id,l.line_user_id,coalesce(q.payload,'{}'::jsonb)||jsonb_build_object('question',q.question_text),gen_random_uuid()
    from public.persistent_group_members m join public.line_account_links l on l.user_id=m.user_id and l.status='active' and not l.delivery_paused
    where m.group_id=g.id and m.status='active' and m.line_opt_in and not exists(select 1 from public.daily_deliveries d where d.daily_question_id=q.id and d.member_id=m.id); end if;
  return q;
end $$;

create or replace function public.daily_prepare_and_advance(p_group_id uuid,p_local_date date,p_source_deck_id text,p_question_id text,p_question_text text,p_payload jsonb,p_expected_run_at timestamptz)
returns public.daily_questions language plpgsql security definer set search_path=public as $$
declare q public.daily_questions; g public.persistent_groups; enabled boolean;
begin
  select * into g from public.persistent_groups where id=p_group_id and status='active' for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  select line_delivery_settings.enabled into enabled from public.line_delivery_settings where id=true;
  if not coalesce(enabled,false) then raise exception 'LINE_DELIVERY_DISABLED'; end if;
  if g.next_run_at is null or g.next_run_at>now() or g.next_run_at is distinct from p_expected_run_at then raise exception 'DAILY_NOT_DUE'; end if;
  q := public.daily_prepare_question(p_group_id,p_local_date,p_source_deck_id,p_question_id,p_question_text,coalesce(p_payload,'{}'::jsonb));
  update public.persistent_groups set next_run_at=public.persistent_next_run(timezone,delivery_time,greatest(coalesce(next_run_at,now()),now())),updated_at=now() where id=g.id;
  return q;
end $$;

create or replace function public.daily_claim_delivery(p_delivery_id uuid,p_now timestamptz default now())
returns setof public.daily_deliveries language plpgsql security definer set search_path=public as $$
declare d public.daily_deliveries; enabled boolean;
begin
  select line_delivery_settings.enabled into enabled from public.line_delivery_settings where id=true;
  if not coalesce(enabled,false) then raise exception 'LINE_DELIVERY_DISABLED'; end if;
  select x.* into d from public.daily_deliveries x join public.daily_questions q on q.id=x.daily_question_id join public.persistent_groups g on g.id=x.group_id and g.status='active' and q.local_date=(p_now at time zone g.timezone)::date join public.persistent_group_members m on m.id=x.member_id and m.status='active' and m.line_opt_in join public.line_account_links l on l.user_id=x.user_id and l.line_user_id=x.line_user_id and l.status='active' and not l.delivery_paused where x.id=p_delivery_id for update;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  if d.status in('sent','failed','stopped') then return; end if;
  if d.status='sending' and d.lease_until>p_now then return; end if;
  if d.first_attempt_at is not null and d.first_attempt_at+interval '24 hours'<=p_now then
    update public.daily_deliveries set status='unknown',lease_until=null,lease_token=null,updated_at=p_now where id=d.id;
    return;
  end if;
  -- An expired lease is recoverable in this same claim.  Do not make the
  -- scheduler wait for a second drain cycle before retrying the frozen row.
  if d.status='sending' and (d.lease_until is null or d.lease_until<=p_now) then
    d.status := 'unknown';
  end if;
  if d.attempt_count>=d.max_attempts or d.next_attempt_at>p_now then return; end if;
  update public.daily_deliveries set status='sending',attempt_count=attempt_count+1,first_attempt_at=coalesce(first_attempt_at,p_now),lease_until=p_now+interval '5 minutes',lease_token=gen_random_uuid(),updated_at=p_now where id=d.id returning * into d;
  return next d;
end $$;

create or replace function public.daily_list_ready_deliveries(p_now timestamptz default now(),p_limit integer default 100)
returns table(id uuid) language sql security definer set search_path=public as $$
  select d.id from public.daily_deliveries d
  join public.daily_questions q on q.id=d.daily_question_id
  join public.persistent_groups g on g.id=d.group_id and g.status='active' and q.local_date=(p_now at time zone g.timezone)::date
  join public.persistent_group_members m on m.id=d.member_id and m.status='active' and m.line_opt_in
  join public.line_account_links l on l.user_id=d.user_id and l.line_user_id=d.line_user_id and l.status='active' and not l.delivery_paused
  where ((d.status in('pending','unknown') and d.next_attempt_at<=p_now) or (d.status='sending' and d.lease_until<=p_now))
    and d.attempt_count<d.max_attempts and (d.first_attempt_at is null or d.first_attempt_at+interval '24 hours'>p_now)
  order by (d.status='sending' and d.lease_until<=p_now) desc,
    d.created_at desc,d.next_attempt_at asc limit greatest(1,least(p_limit,500));
$$;

create or replace function public.daily_complete_delivery(p_delivery_id uuid,p_status text,p_lease_token uuid,p_request_id text default null,p_error text default null,p_now timestamptz default now())
returns public.daily_deliveries language plpgsql security definer set search_path=public as $$
declare d public.daily_deliveries;
begin
  if p_status not in('sent','failed','unknown','stopped') then raise exception 'INVALID_DELIVERY_STATUS'; end if;
  update public.daily_deliveries set status=p_status,request_id=nullif(left(p_request_id,160),''),last_error=nullif(left(p_error,500),''),sent_at=case when p_status='sent' then p_now else sent_at end,
    next_attempt_at=case when p_status='unknown' then p_now + least(interval '6 hours', interval '5 minutes' * power(2,greatest(attempt_count-1,0))) else next_attempt_at end,
    lease_until=null,lease_token=null,updated_at=p_now where id=p_delivery_id and status='sending' and lease_token=p_lease_token returning * into d;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  return d;
end $$;

create or replace function public.daily_record_checkin(p_delivery_id uuid,p_user_id uuid)
returns public.daily_checkins language plpgsql security definer set search_path=public as $$
declare c public.daily_checkins;
begin
  if not exists(select 1 from public.daily_deliveries d join public.persistent_group_members m on m.id=d.member_id and m.user_id=p_user_id and m.status='active' join public.persistent_groups g on g.id=d.group_id and g.status='active' where d.id=p_delivery_id and d.user_id=p_user_id and d.status<>'stopped') then raise exception 'DELIVERY_NOT_AVAILABLE'; end if;
  insert into public.daily_checkins(delivery_id,daily_question_id,user_id)
    select d.id,d.daily_question_id,p_user_id from public.daily_deliveries d where d.id=p_delivery_id
    on conflict(daily_question_id,user_id) do update set checked_at=excluded.checked_at,delivery_id=excluded.delivery_id returning * into c;
  return c;
end $$;

create or replace function public.daily_record_checkin(p_group_id uuid,p_local_date date,p_user_id uuid)
returns public.daily_checkins language plpgsql security definer set search_path=public as $$
declare c public.daily_checkins; question_row public.daily_questions; d uuid;
begin
  select q.* into question_row from public.daily_questions q join public.persistent_groups g on g.id=q.group_id and g.status='active'
    join public.persistent_group_members m on m.group_id=g.id and m.user_id=p_user_id and m.status='active'
    where q.group_id=p_group_id and q.local_date=p_local_date for update;
  if not found then raise exception 'DELIVERY_NOT_AVAILABLE'; end if;
  select id into d from public.daily_deliveries where daily_question_id=question_row.id and user_id=p_user_id limit 1;
  insert into public.daily_checkins(daily_question_id,user_id,delivery_id) values(question_row.id,p_user_id,d)
    on conflict(daily_question_id,user_id) do update set checked_at=excluded.checked_at,delivery_id=coalesce(excluded.delivery_id,public.daily_checkins.delivery_id)
    returning * into c;
  return c;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('persistent_next_run','persistent_group_create','persistent_group_create_invite','persistent_group_revoke_invites','persistent_group_accept_invite','persistent_group_set_member_status','persistent_group_set_status','persistent_group_advance_run','persistent_group_set_line_opt_in','line_create_link_attempt','line_bind_link_attempt','line_consume_account_link','line_set_link_status','line_record_webhook_event','line_record_account_link_event','daily_prepare_question','daily_prepare_and_advance','daily_claim_delivery','daily_list_ready_deliveries','daily_complete_delivery','daily_record_checkin') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;



-- Integrated repairs and webhook leases (previously 202610120002_daily_line_repairs.sql).
-- Daily Line repair migration: owner edits, schedule guards, and explicit member permissions.
create or replace function public.persistent_group_edit(
  p_group_id uuid,
  p_owner_user_id uuid,
  p_name text,
  p_source_deck_id text,
  p_source_deck_name text,
  p_delivery_time time
) returns public.persistent_groups
language plpgsql security definer set search_path=public as $$
declare g public.persistent_groups; schedule_changed boolean;
begin
  select * into g from public.persistent_groups where id=p_group_id for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if g.owner_user_id<>p_owner_user_id then raise exception 'FORBIDDEN'; end if;
  if btrim(coalesce(p_name,''))='' or btrim(coalesce(p_source_deck_id,''))='' or p_delivery_time is null then raise exception 'INVALID_REQUEST'; end if;
  schedule_changed := g.source_deck_id is distinct from btrim(p_source_deck_id)
    or g.delivery_time is distinct from p_delivery_time;
  update public.persistent_groups set name=btrim(p_name), source_deck_id=btrim(p_source_deck_id),
    source_deck_name=btrim(coalesce(p_source_deck_name,p_source_deck_id)), delivery_time=p_delivery_time,
    next_run_at=case when schedule_changed then public.persistent_next_run(timezone,p_delivery_time) else next_run_at end,
    updated_at=now() where id=g.id returning * into g;
  if schedule_changed then
    update public.daily_deliveries set status='stopped', lease_until=null, lease_token=null, updated_at=now()
      where group_id=g.id and status in ('pending','sending','unknown');
  end if;
  return g;
end $$;
revoke all on function public.persistent_group_edit(uuid,uuid,text,text,text,time) from public,anon,authenticated;
grant execute on function public.persistent_group_edit(uuid,uuid,text,text,text,time) to service_role;

create or replace function public.persistent_group_set_member_status(p_group_id uuid,p_actor_user_id uuid,p_member_user_id uuid,p_status text)
returns public.persistent_group_members language plpgsql security definer set search_path=public as $$
declare m public.persistent_group_members; owner_ok boolean;
begin
  if p_status not in('active','paused','left') then raise exception 'INVALID_MEMBER_STATUS'; end if;
  select exists(select 1 from public.persistent_groups where id=p_group_id and owner_user_id=p_actor_user_id) into owner_ok;
  if p_actor_user_id<>p_member_user_id and not owner_ok then raise exception 'FORBIDDEN'; end if;
  if p_actor_user_id<>p_member_user_id and p_status<>'left' then raise exception 'OWNER_CANNOT_RESUME_MEMBER'; end if;
  select * into m from public.persistent_group_members where group_id=p_group_id and user_id=p_member_user_id for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if m.role='owner' and p_status='left' then raise exception 'OWNER_TRANSFER_REQUIRED'; end if;
  if m.status='left' then raise exception 'REJOIN_INVITE_REQUIRED'; end if;
  update public.persistent_group_members set status=p_status,left_at=case when p_status='left' then now() else null end,line_opt_in=case when p_status='left' then false else line_opt_in end,updated_at=now() where id=m.id returning * into m;
  if p_status in('paused','left') then update public.daily_deliveries set status='stopped',lease_until=null,lease_token=null,next_attempt_at=now(),updated_at=now() where member_id=m.id and status in('pending','sending','unknown'); end if;
  return m;
end $$;
revoke all on function public.persistent_group_set_member_status(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.persistent_group_set_member_status(uuid,uuid,uuid,text) to service_role;

create or replace function public.daily_prepare_and_advance(p_group_id uuid,p_local_date date,p_source_deck_id text,p_question_id text,p_question_text text,p_payload jsonb,p_expected_run_at timestamptz)
returns public.daily_questions language plpgsql security definer set search_path=public as $$
declare q public.daily_questions; g public.persistent_groups; enabled boolean; current_day date;
begin
  select * into g from public.persistent_groups where id=p_group_id and status='active' for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  select line_delivery_settings.enabled into enabled from public.line_delivery_settings where id=true;
  if not coalesce(enabled,false) then raise exception 'LINE_DELIVERY_DISABLED'; end if;
  current_day := (now() at time zone g.timezone)::date;
  if p_local_date is distinct from current_day then raise exception 'DAILY_NOT_CURRENT_DAY'; end if;
  if g.source_deck_id is distinct from p_source_deck_id then raise exception 'DAILY_SOURCE_MISMATCH'; end if;
  if g.next_run_at is null or g.next_run_at>now() or g.next_run_at is distinct from p_expected_run_at then raise exception 'DAILY_NOT_DUE'; end if;
  q := public.daily_prepare_question(p_group_id,p_local_date,p_source_deck_id,p_question_id,p_question_text,coalesce(p_payload,'{}'::jsonb));
  update public.persistent_groups set next_run_at=public.persistent_next_run(timezone,delivery_time,greatest(coalesce(next_run_at,now()),now())),updated_at=now() where id=g.id;
  return q;
end $$;
revoke all on function public.daily_prepare_and_advance(uuid,date,text,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.daily_prepare_and_advance(uuid,date,text,text,text,jsonb,timestamptz) to service_role;

-- Webhook processing leases: claim before any LINE network call and fence late completions.
alter table public.line_webhook_events add column if not exists claim_token text;
alter table public.line_webhook_events add column if not exists claim_until timestamptz;
alter table public.line_webhook_events add column if not exists processing_status text not null default 'pending';
alter table public.line_webhook_events add column if not exists claim_attempts integer not null default 0;
alter table public.line_webhook_events add column if not exists payload jsonb;
alter table public.line_webhook_events add column if not exists reply_started boolean not null default false;
alter table public.line_webhook_events drop constraint if exists line_webhook_events_processing_status_check;
alter table public.line_webhook_events add constraint line_webhook_events_processing_status_check check (processing_status in ('pending','processing','retryable','terminal','done'));

create or replace function public.line_claim_webhook_event(p_event_id text,p_event_type text,p_line_user_id text,p_claim_token text,p_payload jsonb default null)
returns text language plpgsql security definer set search_path=public as $$
declare e public.line_webhook_events; inserted integer;
begin
  if p_event_id is null or p_claim_token is null then raise exception 'INVALID_REQUEST'; end if;
  insert into public.line_webhook_events(event_id,event_type,line_user_id,received_at,claim_token,claim_until,processing_status,claim_attempts,payload,reply_started)
    values(p_event_id,p_event_type,p_line_user_id,now(),p_claim_token,now()+interval '2 minutes','processing',1,p_payload,false)
    on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted=1 then
    return 'claimed';
  end if;
  select * into e from public.line_webhook_events where event_id=p_event_id for update;
  if e.processed_at is not null or e.processing_status in ('done','terminal') then return 'done'; end if;
  if e.processing_status='processing' and coalesce(e.claim_until,now())>now() then return 'busy'; end if;
  if e.reply_started then
    update public.line_webhook_events set processed_at=now(),processing_status='terminal',claim_token=null,claim_until=null where event_id=p_event_id;
    return 'done';
  end if;
  update public.line_webhook_events set claim_token=p_claim_token,claim_until=now()+interval '2 minutes',processing_status='processing',claim_attempts=e.claim_attempts+1,received_at=coalesce(received_at,now()),event_type=coalesce(event_type,p_event_type),line_user_id=coalesce(line_user_id,p_line_user_id),payload=coalesce(payload,p_payload) where event_id=p_event_id;
  return 'claimed';
end $$;

create or replace function public.line_mark_webhook_reply_started(p_event_id text,p_claim_token text)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  update public.line_webhook_events set reply_started=true where event_id=p_event_id and processing_status='processing' and claim_token=p_claim_token and coalesce(claim_until,now())>now() and processed_at is null;
  get diagnostics n=row_count;
  return n=1;
end $$;

create or replace function public.line_release_webhook_event(p_event_id text,p_claim_token text)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  update public.line_webhook_events set processing_status='retryable',claim_token=null,claim_until=null where event_id=p_event_id and processing_status='processing' and claim_token=p_claim_token and coalesce(claim_until,now())>now() and not reply_started and processed_at is null;
  get diagnostics n=row_count;
  return n=1;
end $$;

create or replace function public.line_finalize_webhook_event(p_event_id text,p_claim_token text,p_terminal boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  update public.line_webhook_events set processed_at=now(),processing_status=case when p_terminal then 'terminal' else 'done' end,claim_token=null,claim_until=null where event_id=p_event_id and processing_status='processing' and claim_token=p_claim_token and coalesce(claim_until,now())>now() and processed_at is null;
  get diagnostics n=row_count;
  return n=1;
end $$;

create or replace function public.line_follow_existing(p_line_user_id text)
returns text language plpgsql security definer set search_path=public as $$
declare l public.line_account_links;
begin
  select * into l from public.line_account_links where line_user_id=p_line_user_id for update;
  if not found then return null; end if;
  if l.status='blocked' then
    update public.line_account_links set status='active',delivery_paused=true,updated_at=now() where id=l.id returning * into l;
    return 'active_paused';
  end if;
  if l.status='active' then return case when l.delivery_paused then 'active_paused' else 'active' end; end if;
  return null;
end $$;

revoke all on function public.line_claim_webhook_event(text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.line_mark_webhook_reply_started(text,text) from public,anon,authenticated;
revoke all on function public.line_release_webhook_event(text,text) from public,anon,authenticated;
revoke all on function public.line_finalize_webhook_event(text,text,boolean) from public,anon,authenticated;
revoke all on function public.line_follow_existing(text) from public,anon,authenticated;
grant execute on function public.line_claim_webhook_event(text,text,text,text,jsonb) to service_role;
grant execute on function public.line_mark_webhook_reply_started(text,text) to service_role;
grant execute on function public.line_release_webhook_event(text,text) to service_role;
grant execute on function public.line_finalize_webhook_event(text,text,boolean) to service_role;
grant execute on function public.line_follow_existing(text) to service_role;

-- A claimed account_link event already has a row; do not treat that row as a replay.
create or replace function public.line_record_account_link_event(p_event_id text,p_line_user_id text,p_nonce_hash text,p_result text)
returns public.line_account_links language plpgsql security definer set search_path=public as $$
declare e public.line_webhook_events; linked public.line_account_links; inserted integer;
begin
  insert into public.line_webhook_events(event_id,event_type,line_user_id,processing_status)
    values(p_event_id,'account_link',p_line_user_id,'processing') on conflict(event_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted<>1 then
    select * into e from public.line_webhook_events where event_id=p_event_id for update;
    if e.processed_at is not null or e.processing_status not in ('processing','pending','retryable') then return null; end if;
    return null;
  end if;
  if lower(coalesce(p_result,''))<>'ok' then
    update public.line_webhook_events set processed_at=now(),processing_status='terminal' where event_id=p_event_id;
    return null;
  end if;
  begin
    linked := public.line_consume_account_link(p_nonce_hash,p_line_user_id);
  exception when others then
    if sqlerrm in ('LINK_ATTEMPT_INVALID','LINE_ID_MISMATCH','LINE_ID_ALREADY_LINKED') then
      update public.line_webhook_events set processed_at=now(),processing_status='terminal' where event_id=p_event_id;
      return null;
    end if;
    raise;
  end;
  update public.line_webhook_events set processed_at=now(),processing_status='done' where event_id=p_event_id;
  return linked;
end $$;
revoke all on function public.line_record_account_link_event(text,text,text,text) from public,anon,authenticated;
grant execute on function public.line_record_account_link_event(text,text,text,text) to service_role;

commit;
