begin;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'), name text not null check (char_length(btrim(name)) between 1 and 120), created_by uuid not null references auth.users(id) on delete cascade, status text not null default 'active' check (status in ('active','suspended')), created_at timestamptz not null default now()
);
create table if not exists public.organization_members (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, email_normalized text not null check (char_length(email_normalized) between 3 and 254), display_name text not null check (char_length(btrim(display_name)) between 1 and 80), department text check (department is null or char_length(department)<=80), status text not null default 'pending' check (status in ('pending','active','suspended')), role text not null default 'member' check (role in ('owner','admin','member')), claimed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists organization_members_email_uq on public.organization_members(organization_id,email_normalized);
create unique index if not exists organization_members_user_uq on public.organization_members(organization_id,user_id) where user_id is not null;
create index if not exists organization_members_org_idx on public.organization_members(organization_id,status,role);
create table if not exists public.organization_policies (
 organization_id uuid primary key references public.organizations(id) on delete cascade, allowed_theme_ids jsonb not null default '["team","founders","self-work"]'::jsonb check (jsonb_typeof(allowed_theme_ids)='array' and jsonb_array_length(allowed_theme_ids)<=100), feature_flags jsonb not null default '{"group_play":true,"solo_play":true,"theme_mix":false,"audio":true,"theme_tags":true}'::jsonb, updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(), check (jsonb_typeof(feature_flags)='object' and feature_flags ?& array['group_play','solo_play','theme_mix','audio','theme_tags']), check (jsonb_typeof(feature_flags->'group_play')='boolean' and jsonb_typeof(feature_flags->'solo_play')='boolean' and jsonb_typeof(feature_flags->'theme_mix')='boolean' and jsonb_typeof(feature_flags->'audio')='boolean' and jsonb_typeof(feature_flags->'theme_tags')='boolean')
);
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_policies enable row level security;
revoke all on public.organizations, public.organization_members, public.organization_policies from anon, authenticated;
grant select,insert,update,delete on public.organizations, public.organization_members, public.organization_policies to service_role;

create or replace function public.org_member(p_org uuid,p_user uuid) returns public.organization_members language sql stable security definer set search_path=public,auth as $$ select m.* from public.organization_members m join public.organizations o on o.id=m.organization_id and o.status='active' join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null where m.organization_id=p_org and m.user_id=p_user and m.status='active' and lower(u.email)=lower(m.email_normalized) limit 1 $$;
create or replace function public.org_capable(p_org uuid,p_user uuid,p_cap text) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.org_member(p_org,p_user) m where m.role='owner' or m.role='admin' or (p_cap='themes.use' and m.role='member')) $$;
revoke all on function public.org_member(uuid,uuid),public.org_capable(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.org_create(p_actor uuid,p_slug text,p_name text) returns public.organizations language plpgsql security definer set search_path=public,auth as $$
declare n integer;
o public.organizations;
u auth.users;
begin
 select * into u from auth.users where id=p_actor and email_confirmed_at is not null;
if u.id is null then raise exception 'ORG_FORBIDDEN';
end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
select count(*) into n from organizations where created_by=p_actor;
if n>=3 then raise exception 'ORG_LIMIT';
end if;
 if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' or p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'INVALID_REQUEST';
end if;
 insert into organizations(slug,name,created_by) values(lower(btrim(p_slug)),btrim(p_name),p_actor) returning * into o;
 insert into organization_members(organization_id,user_id,email_normalized,display_name,status,role,claimed_at) values(o.id,p_actor,lower(u.email),coalesce(nullif(left(btrim(u.raw_user_meta_data->>'display_name'),80),''),left(u.email,80)),'active','owner',now());
 insert into organization_policies(organization_id,updated_by) values(o.id,p_actor);
return o;
exception when unique_violation then raise exception 'ORG_CONFLICT';
end;
$$;

create or replace function public.org_list(p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare u auth.users;
result jsonb;
begin
 select * into u from auth.users where id=p_actor and email_confirmed_at is not null;
if u.id is null then raise exception 'ORG_FORBIDDEN';
end if;
 select coalesce(jsonb_agg(jsonb_build_object('organizationId',m.organization_id,'name',o.name,'slug',o.slug,'role',m.role,'status',m.status) order by o.created_at),'[]'::jsonb) into result from organization_members m join organizations o on o.id=m.organization_id where m.user_id=p_actor and m.status='active' and o.status='active' and lower(m.email_normalized)=lower(u.email);
return result;
end;
$$;
create or replace function public.org_workspace(p_actor uuid,p_org uuid) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare actor organization_members;
o organizations;
p organization_policies;
members jsonb:='[]'::jsonb;
begin
 actor:=org_member(p_org,p_actor);
if actor.id is null then raise exception 'ORG_FORBIDDEN';
end if;
select * into o from organizations where id=p_org and status='active';
select * into p from organization_policies where organization_id=p_org;
 if actor.role in ('owner','admin') then select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'email_normalized',m.email_normalized,'display_name',m.display_name,'department',m.department,'status',m.status,'role',m.role,'claimed_at',m.claimed_at) order by m.created_at),'[]'::jsonb) into members from organization_members m where m.organization_id=p_org;
end if;
 return jsonb_build_object('organization',jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug),'role',actor.role,'allowedThemeIds',coalesce(p.allowed_theme_ids,'[]'::jsonb),'featureFlags',coalesce(p.feature_flags,'{}'::jsonb),'members',members);
end;
$$;

create or replace function public.org_import_members(p_actor uuid,p_org uuid,p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m jsonb;
actor organization_members;
email text;
dept text;
display text;
count_new integer:=0;
existing integer:=0;
seen jsonb:='{}'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
actor:=org_member(p_org,p_actor);
if actor.id is null or actor.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN';
end if;
if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>500 then raise exception 'CSV_LIMIT';
end if;
 for m in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(m) is distinct from 'object' or exists(select 1 from jsonb_object_keys(m) k where k not in ('email','display_name','department')) or not (m ? 'email') or not (m ? 'display_name') or jsonb_typeof(m->'email') is distinct from 'string' or jsonb_typeof(m->'display_name') is distinct from 'string' or ((m ? 'department') and jsonb_typeof(m->'department') is distinct from 'string') then raise exception 'CSV_INVALID';
end if;
  email:=lower(btrim(m->>'email'));
display:=btrim(m->>'display_name');
dept:=nullif(btrim(coalesce(m->>'department','')),'');
if email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(email)>254 or char_length(display)<1 or char_length(display)>80 or (dept is not null and char_length(dept)>80) then raise exception 'CSV_INVALID';
end if;
if seen ? email then raise exception 'CSV_INVALID';
end if;
seen:=seen || jsonb_build_object(email,true);
 end loop;
 for m in select value from jsonb_array_elements(p_rows) loop
  email:=lower(btrim(m->>'email'));
display:=btrim(m->>'display_name');
dept:=nullif(btrim(coalesce(m->>'department','')),'');
if exists(select 1 from organization_members where organization_id=p_org and email_normalized=email) then existing:=existing+1;
continue;
end if;
if (select count(*) from organization_members where organization_id=p_org)>=500 then raise exception 'ORG_MEMBER_LIMIT';
end if;
insert into organization_members(organization_id,email_normalized,display_name,department) values(p_org,email,display,dept);
count_new:=count_new+1;
 end loop;
return jsonb_build_object('created',count_new,'skipped',existing);
end;
$$;

create or replace function public.org_set_member(p_actor uuid,p_org uuid,p_member uuid,p_status text default null,p_role text default null) returns public.organization_members language plpgsql security definer set search_path=public as $$
declare old organization_members;
actor organization_members;
outrow organization_members;
next_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
actor:=org_member(p_org,p_actor);
if actor.id is null or actor.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN';
end if;
select * into old from organization_members where id=p_member and organization_id=p_org for update;
if old.id is null or old.role='owner' then raise exception 'OWNER_REQUIRED';
end if;
if actor.role='admin' and old.role<>'member' then raise exception 'ORG_FORBIDDEN';
end if;
if p_status is not null and p_status not in ('active','suspended') then raise exception 'INVALID_REQUEST';
end if;
if p_role is not null and (actor.role<>'owner' or p_role not in ('member','admin')) then raise exception 'OWNER_REQUIRED';
end if;
next_status:=coalesce(p_status,old.status);
if next_status='active' and old.user_id is null then next_status:='pending';
end if;
update organization_members set status=next_status,role=coalesce(p_role,role),updated_at=now() where id=p_member returning * into outrow;
return outrow;
end;
$$;
create or replace function public.org_claim_members(p_user uuid) returns integer language plpgsql security definer set search_path=public,auth as $$
declare u auth.users;
n integer;
begin
 select * into u from auth.users where id=p_user and email_confirmed_at is not null;
if u.id is null then raise exception 'ORG_FORBIDDEN';
end if;
perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
update organization_members m set user_id=p_user,status='active',claimed_at=now(),updated_at=now() from organizations o where o.id=m.organization_id and o.status='active' and m.status='pending' and m.user_id is null and lower(m.email_normalized)=lower(u.email);
get diagnostics n=row_count;
return n;
end;
$$;
create or replace function public.org_remove_member(p_actor uuid,p_org uuid,p_member uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare old organization_members;
actor organization_members;
begin perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
actor:=org_member(p_org,p_actor);
select * into old from organization_members where id=p_member and organization_id=p_org for update;
if old.id is null or actor.id is null or actor.role not in ('owner','admin') or old.role='owner' or (actor.role='admin' and old.role='admin') then raise exception 'ORG_FORBIDDEN';
end if;
delete from organization_members where id=p_member;
return true;
end;
$$;
create or replace function public.org_delete(p_actor uuid,p_org uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare actor organization_members;
begin perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
actor:=org_member(p_org,p_actor);
if actor.id is null or actor.role<>'owner' then raise exception 'ORG_FORBIDDEN';
end if;
delete from organizations where id=p_org;
return true;
end;
$$;
create or replace function public.org_set_policy(p_actor uuid,p_org uuid,p_themes jsonb,p_flags jsonb) returns public.organization_policies language plpgsql security definer set search_path=public as $$
declare actor organization_members;
outrow organization_policies;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
actor:=org_member(p_org,p_actor);
if actor.id is null or actor.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN';
end if;
if p_themes is null or jsonb_typeof(p_themes)<>'array' or jsonb_array_length(p_themes)>100 or exists(select 1 from jsonb_array_elements(p_themes) x where jsonb_typeof(x) is distinct from 'string' or x #>> '{}' !~ '^[a-z0-9][a-z0-9-]{0,63}$' or x #>> '{}' like '%r18%') then raise exception 'POLICY_INVALID';
end if;
if p_flags is null or jsonb_typeof(p_flags)<>'object' or (select count(*) from jsonb_object_keys(p_flags))<>5 or exists(select 1 from jsonb_object_keys(p_flags) k where k not in ('group_play','solo_play','theme_mix','audio','theme_tags')) or not (p_flags ?& array['group_play','solo_play','theme_mix','audio','theme_tags']) or exists(select 1 from jsonb_object_keys(p_flags) k where jsonb_typeof(p_flags->k)<>'boolean') or not (p_flags->>'group_play'='true' or p_flags->>'solo_play'='true') then raise exception 'POLICY_INVALID';
end if;
insert into organization_policies(organization_id,allowed_theme_ids,feature_flags,updated_by) values(p_org,p_themes,p_flags,p_actor) on conflict(organization_id) do update set allowed_theme_ids=excluded.allowed_theme_ids,feature_flags=excluded.feature_flags,updated_by=excluded.updated_by,updated_at=now() returning * into outrow;
return outrow;
end;
$$;

revoke all on function public.org_create(uuid,text,text),public.org_list(uuid),public.org_workspace(uuid,uuid),public.org_import_members(uuid,uuid,jsonb),public.org_set_member(uuid,uuid,uuid,text,text),public.org_remove_member(uuid,uuid,uuid),public.org_delete(uuid,uuid),public.org_set_policy(uuid,uuid,jsonb,jsonb),public.org_claim_members(uuid) from public,anon,authenticated;
grant execute on function public.org_create(uuid,text,text),public.org_list(uuid),public.org_workspace(uuid,uuid),public.org_import_members(uuid,uuid,jsonb),public.org_set_member(uuid,uuid,uuid,text,text),public.org_remove_member(uuid,uuid,uuid),public.org_delete(uuid,uuid),public.org_set_policy(uuid,uuid,jsonb,jsonb),public.org_claim_members(uuid) to service_role;
commit;
