begin;

-- Organization-only card market. No personal my_sets/custom_cards are used.
create table if not exists public.organization_card_market_entitlements (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  active_until timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.organization_card_market_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  audience text not null check (audience in ('group','solo','both')),
  min_participants integer not null default 1 check (min_participants between 1 and 8),
  max_participants integer not null default 8 check (max_participants between min_participants and 8),
  visibility text not null check (visibility in ('all','departments')),
  target_departments text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','published','stopped')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (visibility='all' or cardinality(target_departments) between 1 and 100)
);
alter table public.organization_card_market_sets add column if not exists min_participants integer not null default 1;
alter table public.organization_card_market_sets add column if not exists max_participants integer not null default 8;
create index if not exists organization_card_market_sets_org_idx on public.organization_card_market_sets(organization_id,status,updated_at desc);
create table if not exists public.organization_card_market_versions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.organization_card_market_sets(id) on delete cascade,
  version integer not null check (version > 0),
  cards jsonb not null check (jsonb_typeof(cards)='array' and jsonb_array_length(cards) between 1 and 100),
  card_count integer not null check (card_count between 1 and 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(set_id,version)
);
create index if not exists organization_card_market_versions_set_idx on public.organization_card_market_versions(set_id,version desc);
create or replace function public.prevent_org_card_market_version_update() returns trigger language plpgsql as $$ begin if new.set_id is distinct from old.set_id or new.version is distinct from old.version or new.cards is distinct from old.cards or new.card_count is distinct from old.card_count then raise exception 'CARD_MARKET_VERSION_IMMUTABLE'; end if; return new; end; $$;
drop trigger if exists organization_card_market_version_immutable on public.organization_card_market_versions;
create trigger organization_card_market_version_immutable before update on public.organization_card_market_versions for each row execute function public.prevent_org_card_market_version_update();
alter table public.organization_card_market_entitlements enable row level security;
alter table public.organization_card_market_sets enable row level security;
alter table public.organization_card_market_versions enable row level security;
revoke all on public.organization_card_market_entitlements,public.organization_card_market_sets,public.organization_card_market_versions from public,anon,authenticated;
grant all on public.organization_card_market_entitlements,public.organization_card_market_sets,public.organization_card_market_versions to service_role;

create or replace function public.org_card_market_entitlement(p_actor uuid,p_org uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m organization_members; e organization_card_market_entitlements;
begin
 m:=org_member(p_org,p_actor); if m.id is null then raise exception 'ORG_FORBIDDEN'; end if;
 select * into e from organization_card_market_entitlements where organization_id=p_org;
 return jsonb_build_object('active',e.organization_id is not null and (e.active_until is null or e.active_until>now()),'activeUntil',e.active_until);
end; $$;

create or replace function public.org_card_market_context(p_actor uuid,p_org uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m organization_members; e organization_card_market_entitlements;
begin
 m:=org_member(p_org,p_actor); if m.id is null then raise exception 'ORG_FORBIDDEN'; end if;
 select * into e from organization_card_market_entitlements where organization_id=p_org;
 return jsonb_build_object('role',m.role,'department',m.department,'entitlementActive',e.organization_id is not null and (e.active_until is null or e.active_until>now()),'entitlementUntil',e.active_until,'departments',(select coalesce(jsonb_agg(distinct z.department order by z.department) filter(where z.department is not null),'[]'::jsonb) from organization_members z where z.organization_id=p_org and z.status='active'));
end; $$;

-- Operations use this helper so missing/expired entitlement fails closed.
create or replace function public.org_card_market_has_entitlement(p_org uuid) returns boolean language sql security definer set search_path=public as $$
 select exists(select 1 from organization_card_market_entitlements where organization_id=p_org and (active_until is null or active_until>now()));
$$;

create or replace function public.org_card_market_list(p_actor uuid,p_org uuid,p_include_drafts boolean default false)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m organization_members; result jsonb;
begin
 m:=org_member(p_org,p_actor); if m.id is null then raise exception 'ORG_FORBIDDEN'; end if;
 if p_include_drafts and m.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'description',s.description,'audience',s.audience,'minParticipants',s.min_participants,'maxParticipants',s.max_participants,'visibility',s.visibility,'targetDepartments',s.target_departments,'status',s.status,'version',v.version,'cardCount',v.card_count,'createdAt',s.created_at,'updatedAt',s.updated_at) order by s.updated_at desc),'[]'::jsonb) into result
 from organization_card_market_sets s left join lateral (select * from organization_card_market_versions x where x.set_id=s.id order by x.version desc limit 1) v on true
 where s.organization_id=p_org and ((m.role in ('owner','admin') and p_include_drafts) or (s.status='published' and (s.visibility='all' or m.department=any(s.target_departments))));
 return result;
end; $$;

create or replace function public.org_card_market_save(p_actor uuid,p_org uuid,p_set uuid,p_title text,p_description text,p_audience text,p_visibility text,p_departments text[],p_status text,p_cards jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m organization_members; s organization_card_market_sets; v organization_card_market_versions; next_version integer; item jsonb;
begin
 m:=org_member(p_org,p_actor); if m.id is null or m.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN'; end if;
 if not org_card_market_has_entitlement(p_org) then raise exception 'ENTITLEMENT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('card-market:'||p_org::text,0));
 if p_set is null and (select count(*) from organization_card_market_sets where organization_id=p_org)>=100 then raise exception 'CARD_MARKET_LIMIT'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 120 or p_description is null or char_length(p_description)>500 or p_audience is null or p_audience not in ('group','solo','both') or p_visibility is null or p_visibility not in ('all','departments') or p_status is null or p_status not in ('draft','published') or p_cards is null or jsonb_typeof(p_cards)<>'array' or jsonb_array_length(p_cards) not between 1 and 100 or octet_length(p_cards::text)+octet_length(p_title)+octet_length(p_description)>262144 then raise exception 'CARD_MARKET_INVALID'; end if;
 if p_visibility='departments' and (p_departments is null or cardinality(p_departments)<1 or cardinality(p_departments)>100) then raise exception 'CARD_MARKET_INVALID'; end if;
 if p_visibility='all' and coalesce(cardinality(p_departments),0)>0 then raise exception 'CARD_MARKET_INVALID'; end if;
 if p_visibility='departments' and exists(select 1 from unnest(p_departments) x where x is null or btrim(x)='' or not exists(select 1 from organization_members z where z.organization_id=p_org and z.status='active' and z.department=btrim(x))) then raise exception 'DEPARTMENT_INVALID'; end if;
 p_departments:=coalesce((select array_agg(distinct btrim(x) order by btrim(x)) from unnest(p_departments) x),'{}');
 for item in select value from jsonb_array_elements(p_cards) loop if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>1 or not (item ? 'text') or jsonb_typeof(item->'text')<>'string' or char_length(btrim(item->>'text')) not between 1 and 1000 then raise exception 'CARD_MARKET_INVALID'; end if; end loop;
 select jsonb_agg(jsonb_build_object('text',btrim(value->>'text'))) into p_cards from jsonb_array_elements(p_cards);
 if p_set is null then insert into organization_card_market_sets(organization_id,title,description,audience,visibility,target_departments,status,created_by,updated_by) values(p_org,btrim(p_title),btrim(p_description),p_audience,p_visibility,coalesce(p_departments,'{}'),p_status,p_actor,p_actor) returning * into s;
 else select * into s from organization_card_market_sets where id=p_set and organization_id=p_org for update; if s.id is null then raise exception 'CARD_MARKET_NOT_FOUND'; end if; update organization_card_market_sets set title=btrim(p_title),description=btrim(p_description),audience=p_audience,visibility=p_visibility,target_departments=coalesce(p_departments,'{}'),status=p_status,updated_by=p_actor,updated_at=now() where id=s.id returning * into s; end if;
 select coalesce(max(version),0)+1 into next_version from organization_card_market_versions where set_id=s.id;
 insert into organization_card_market_versions(set_id,version,cards,card_count,created_by) values(s.id,next_version,p_cards,jsonb_array_length(p_cards),p_actor) returning * into v;
 return jsonb_build_object('id',s.id,'title',s.title,'description',s.description,'audience',s.audience,'visibility',s.visibility,'targetDepartments',s.target_departments,'status',s.status,'version',v.version,'cardCount',v.card_count);
end; $$;

create or replace function public.org_card_market_save_v2(p_actor uuid,p_org uuid,p_set uuid,p_title text,p_description text,p_audience text,p_min integer,p_max integer,p_visibility text,p_departments text[],p_status text,p_cards jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare result jsonb;
begin
 if p_min is null or p_max is null or p_min<1 or p_max< p_min or p_max>8 then raise exception 'CARD_MARKET_INVALID'; end if;
 if p_audience='solo' and (p_min<>1 or p_max<>1) then raise exception 'CARD_MARKET_INVALID'; end if;
 if p_audience='group' and p_min<2 then raise exception 'CARD_MARKET_INVALID'; end if;
 result:=public.org_card_market_save(p_actor,p_org,p_set,p_title,p_description,p_audience,p_visibility,p_departments,p_status,p_cards);
 update organization_card_market_sets set min_participants=p_min,max_participants=p_max where id=(result->>'id')::uuid and organization_id=p_org;
 return result || jsonb_build_object('minParticipants',p_min,'maxParticipants',p_max);
end; $$;

create or replace function public.org_card_market_detail(p_actor uuid,p_org uuid,p_set uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m organization_members; s organization_card_market_sets; v organization_card_market_versions;
begin
 m:=org_member(p_org,p_actor); if m.id is null or m.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN'; end if;
 select * into s from organization_card_market_sets where id=p_set and organization_id=p_org; if s.id is null then raise exception 'CARD_MARKET_NOT_FOUND'; end if;
 select * into v from organization_card_market_versions where set_id=s.id order by version desc limit 1;
 return jsonb_build_object('id',s.id,'title',s.title,'description',s.description,'audience',s.audience,'minParticipants',s.min_participants,'maxParticipants',s.max_participants,'visibility',s.visibility,'targetDepartments',s.target_departments,'status',s.status,'version',v.version,'cards',v.cards,'cardCount',v.card_count);
end; $$;

create or replace function public.org_card_market_stop(p_actor uuid,p_org uuid,p_set uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m organization_members; s organization_card_market_sets;
begin m:=org_member(p_org,p_actor); if m.id is null or m.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN'; end if; update organization_card_market_sets set status='stopped',updated_by=p_actor,updated_at=now() where id=p_set and organization_id=p_org returning * into s; if s.id is null then raise exception 'CARD_MARKET_NOT_FOUND'; end if; return jsonb_build_object('id',s.id,'status',s.status); end; $$;

create or replace function public.org_card_market_duplicate(p_actor uuid,p_org uuid,p_set uuid,p_title text,p_description text,p_visibility text,p_departments text[])
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m organization_members; s organization_card_market_sets; v organization_card_market_versions; next jsonb;
begin m:=org_member(p_org,p_actor); if m.id is null or m.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN'; end if; perform pg_advisory_xact_lock(hashtextextended('card-market:'||p_org::text,0)); if not org_card_market_has_entitlement(p_org) then raise exception 'ENTITLEMENT_REQUIRED'; end if; select * into s from organization_card_market_sets where id=p_set and organization_id=p_org; if s.id is null then raise exception 'CARD_MARKET_NOT_FOUND'; end if; select * into v from organization_card_market_versions where set_id=s.id order by version desc limit 1; if v.id is null then raise exception 'CARD_MARKET_INVALID'; end if; return public.org_card_market_save_v2(p_actor,p_org,null,coalesce(nullif(btrim(p_title),''),left(s.title,116)||' コピー'),coalesce(p_description,s.description),s.audience,s.min_participants,s.max_participants,p_visibility,p_departments,'draft',v.cards); end; $$;

create or replace function public.org_card_market_play(p_actor uuid,p_org uuid,p_set uuid,p_mode text,p_participant_count integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare m organization_members; s organization_card_market_sets; v organization_card_market_versions; flags jsonb;
begin
 m:=org_member(p_org,p_actor); if m.id is null or m.status<>'active' then raise exception 'ORG_FORBIDDEN'; end if; if not org_card_market_has_entitlement(p_org) then raise exception 'ENTITLEMENT_REQUIRED'; end if;
 select * into s from organization_card_market_sets where id=p_set and organization_id=p_org and status='published'; if s.id is null or (s.visibility='all' or m.department=any(s.target_departments)) is not true then raise exception 'CARD_MARKET_NOT_FOUND'; end if;
 if p_mode is null or p_mode not in ('group','solo') or p_participant_count is null or (p_mode='group' and (p_participant_count<s.min_participants or p_participant_count>s.max_participants)) or (p_mode='solo' and (p_participant_count<s.min_participants or p_participant_count>s.max_participants)) or (s.audience not in (p_mode,'both')) then raise exception 'PARTICIPANT_COUNT_INVALID'; end if;
 select feature_flags into flags from organization_policies where organization_id=p_org; if p_mode='group' and coalesce((flags->>'group_play')::boolean,false) is not true then raise exception 'FEATURE_DISABLED'; end if; if p_mode='solo' and coalesce((flags->>'solo_play')::boolean,false) is not true then raise exception 'FEATURE_DISABLED'; end if;
 select * into v from organization_card_market_versions where set_id=s.id order by version desc limit 1; return jsonb_build_object('id',s.id,'title',s.title,'audience',s.audience,'version',v.version,'cards',v.cards,'participantCount',p_participant_count,'mode',p_mode);
end; $$;

revoke all on function public.org_card_market_entitlement(uuid,uuid),public.org_card_market_context(uuid,uuid),public.org_card_market_list(uuid,uuid,boolean),public.org_card_market_detail(uuid,uuid,uuid),public.org_card_market_save(uuid,uuid,uuid,text,text,text,text,text[],text,jsonb),public.org_card_market_save_v2(uuid,uuid,uuid,text,text,text,integer,integer,text,text[],text,jsonb),public.org_card_market_stop(uuid,uuid,uuid),public.org_card_market_duplicate(uuid,uuid,uuid,text,text,text,text[]),public.org_card_market_play(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.org_card_market_entitlement(uuid,uuid),public.org_card_market_context(uuid,uuid),public.org_card_market_list(uuid,uuid,boolean),public.org_card_market_detail(uuid,uuid,uuid),public.org_card_market_save(uuid,uuid,uuid,text,text,text,text,text[],text,jsonb),public.org_card_market_save_v2(uuid,uuid,uuid,text,text,text,integer,integer,text,text[],text,jsonb),public.org_card_market_stop(uuid,uuid,uuid),public.org_card_market_duplicate(uuid,uuid,uuid,text,text,text,text[]),public.org_card_market_play(uuid,uuid,uuid,text,integer) to service_role;
-- Entitlement is deliberately service-role/SQL managed; no HTTP grant endpoint exists.
revoke all on function public.org_card_market_has_entitlement(uuid) from public,anon,authenticated,service_role;
grant execute on function public.org_card_market_has_entitlement(uuid) to service_role;
commit;
