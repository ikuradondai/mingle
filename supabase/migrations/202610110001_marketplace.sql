-- Free community marketplace. Published versions are immutable snapshots.
begin;
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_set_id uuid references public.my_sets(id) on delete set null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique(owner_id, source_set_id)
);
create table if not exists public.marketplace_versions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  category text not null check (category in ('self','relationship','friends','family','work','sports','first-meeting','roleplay','adult')),
  audience text not null check (audience in ('group','solo','both')),
  question_order text not null check (question_order in ('shuffle','fixed')),
  adult_only boolean not null default false,
  publisher_name text not null check (char_length(btrim(publisher_name)) between 1 and 40),
  cards jsonb not null check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) between 6 and 40),
  card_count integer not null check (card_count between 6 and 40),
  created_at timestamptz not null default now(),
  unique(listing_id, version)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='marketplace_current_version_fk') then
    alter table public.marketplace_listings add constraint marketplace_current_version_fk foreign key (current_version_id) references public.marketplace_versions(id) deferrable initially deferred;
  end if;
end $$;
create table if not exists public.marketplace_imports (
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_id uuid not null references public.marketplace_versions(id) on delete restrict,
  imported_set_id uuid references public.my_sets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create table if not exists public.marketplace_likes (
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create index if not exists marketplace_active_idx on public.marketplace_listings(withdrawn_at, updated_at desc);
create index if not exists marketplace_versions_listing_idx on public.marketplace_versions(listing_id, version desc);
create index if not exists marketplace_imports_user_idx on public.marketplace_imports(user_id, created_at desc);
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_versions enable row level security;
alter table public.marketplace_imports enable row level security;
alter table public.marketplace_likes enable row level security;

create or replace function public.prevent_marketplace_version_update() returns trigger language plpgsql as $$
begin raise exception 'MARKETPLACE_VERSION_IMMUTABLE' using errcode='42501'; end; $$;
drop trigger if exists marketplace_version_immutable on public.marketplace_versions;
create trigger marketplace_version_immutable before update on public.marketplace_versions for each row execute function public.prevent_marketplace_version_update();

create or replace function public.marketplace_publish(p_user_id uuid, p_set_id uuid, p_name text, p_description text, p_category text, p_publisher_name text, p_audience text, p_question_order text, p_adult_only boolean, p_allow_adult boolean, p_cards jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare s public.my_sets%rowtype; l public.marketplace_listings%rowtype; v public.marketplace_versions%rowtype; ids text[]; supplied text[]; next_version integer; item jsonb; cards_adult boolean;
begin
  if p_user_id is null or p_set_id is null or p_cards is null or jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) not between 6 and 40 then raise exception 'INVALID_MARKETPLACE_SET' using errcode='22023'; end if;
  if p_category not in ('self','relationship','friends','family','work','sports','first-meeting','roleplay','adult') or p_audience not in ('group','solo','both') or p_question_order not in ('shuffle','fixed') then raise exception 'INVALID_MARKETPLACE_METADATA' using errcode='22023'; end if;
  if char_length(btrim(p_name)) not between 1 and 80 or char_length(p_description) > 500 or char_length(btrim(p_publisher_name)) not between 1 and 40 then raise exception 'INVALID_MARKETPLACE_TEXT' using errcode='22023'; end if;
  select * into s from public.my_sets where id=p_set_id and user_id=p_user_id for update;
  if not found then raise exception 'SOURCE_SET_NOT_FOUND' using errcode='42501'; end if;
  if p_audience is distinct from s.audience or p_question_order is distinct from s.question_order then raise exception 'SOURCE_METADATA_CHANGED' using errcode='40001'; end if;
  ids := s.card_ids;
  for item in select value from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(item) <> 'object' or item->>'id' is null or item->>'text' is null or jsonb_typeof(item->'r18') <> 'boolean' or char_length(btrim(item->>'text')) not between 1 and 300 or item->>'text' <> btrim(item->>'text') then raise exception 'CARD_SNAPSHOT_INVALID' using errcode='22023'; end if;
  end loop;
  select array_agg(value order by ord) into supplied from jsonb_array_elements_text(p_cards) with ordinality as x(value,ord);
  -- The API sends cards as objects; compare the object id list to the owned set.
  select array_agg(value->>'id' order by ord) into supplied from jsonb_array_elements(p_cards) with ordinality as x(value,ord);
  if supplied is distinct from ids then raise exception 'SOURCE_CARDS_CHANGED' using errcode='40001'; end if;
  select coalesce(bool_or(coalesce((x.value->>'r18')::boolean,false)),false) into cards_adult from jsonb_array_elements(p_cards) x;
  if p_adult_only is distinct from cards_adult then raise exception 'ADULT_METADATA_INVALID' using errcode='22023'; end if;
  if cards_adult and (p_allow_adult is not true or not public.is_adult_confirmed(p_user_id)) then raise exception 'AGE_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  select * into l from public.marketplace_listings where owner_id=p_user_id and source_set_id=p_set_id for update;
  if not found then insert into public.marketplace_listings(owner_id,source_set_id) values(p_user_id,p_set_id) returning * into l; end if;
  select coalesce(max(version),0)+1 into next_version from public.marketplace_versions where listing_id=l.id;
  insert into public.marketplace_versions(listing_id,version,name,description,category,audience,question_order,adult_only,publisher_name,cards,card_count)
    values(l.id,next_version,btrim(p_name),btrim(p_description),p_category,p_audience,p_question_order,p_adult_only,btrim(p_publisher_name),p_cards,jsonb_array_length(p_cards)) returning * into v;
  update public.marketplace_listings set current_version_id=v.id, withdrawn_at=null, updated_at=now() where id=l.id returning * into l;
  return jsonb_build_object('listingId',l.id,'versionId',v.id,'version',v.version);
end; $$;

create or replace function public.marketplace_import(p_user_id uuid, p_listing_id uuid, p_allow_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare l public.marketplace_listings%rowtype; v public.marketplace_versions%rowtype; old public.marketplace_imports%rowtype; item jsonb; ids text[] := '{}'; new_id uuid; existing text; name text;
begin
  select * into l from public.marketplace_listings where id=p_listing_id and withdrawn_at is null for update;
  if not found or l.current_version_id is null then raise exception 'MARKETPLACE_NOT_FOUND' using errcode='P0002'; end if;
  select * into v from public.marketplace_versions where id=l.current_version_id;
  if v.adult_only and (p_allow_adult is not true or not public.is_adult_confirmed(p_user_id)) then raise exception 'AGE_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  select * into old from public.marketplace_imports where listing_id=l.id and user_id=p_user_id for update;
  if found and old.imported_set_id is not null and exists(select 1 from public.my_sets where id=old.imported_set_id and user_id=p_user_id) then return jsonb_build_object('setId',old.imported_set_id,'imported',false,'versionId',old.version_id); end if;
  for item in select value from jsonb_array_elements(v.cards) loop
    if item->>'text' is null or char_length(btrim(item->>'text')) not between 1 and 300 then raise exception 'CARD_SNAPSHOT_INVALID' using errcode='22023'; end if;
    insert into public.custom_cards(user_id,text,r18) values(p_user_id,btrim(item->>'text'),coalesce((item->>'r18')::boolean,false)) returning id into new_id;
    ids := array_append(ids,'custom:'||new_id::text);
  end loop;
  name := v.name;
  insert into public.my_sets(user_id,name,card_ids,audience,question_order) values(p_user_id,name,ids,v.audience,v.question_order) returning id into new_id;
  insert into public.marketplace_imports(listing_id,user_id,version_id,imported_set_id) values(l.id,p_user_id,v.id,new_id)
    on conflict(listing_id,user_id) do update set version_id=excluded.version_id, imported_set_id=excluded.imported_set_id, updated_at=now();
  return jsonb_build_object('setId',new_id,'imported',true,'versionId',v.id);
end; $$;

create or replace function public.marketplace_like(p_user_id uuid, p_listing_id uuid, p_like boolean, p_allow_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not exists(select 1 from public.marketplace_listings l where l.id=p_listing_id and l.withdrawn_at is null) then raise exception 'MARKETPLACE_NOT_FOUND' using errcode='P0002'; end if;
  if exists(select 1 from public.marketplace_listings l join public.marketplace_versions v on v.id=l.current_version_id where l.id=p_listing_id and v.adult_only) and (p_allow_adult is not true or not public.is_adult_confirmed(p_user_id)) then raise exception 'AGE_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  if p_like then insert into public.marketplace_likes(listing_id,user_id) values(p_listing_id,p_user_id) on conflict do nothing; else delete from public.marketplace_likes where listing_id=p_listing_id and user_id=p_user_id; end if;
  return jsonb_build_object('liked',p_like);
end; $$;

create or replace function public.marketplace_withdraw(p_user_id uuid, p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  update public.marketplace_listings set withdrawn_at=now(), updated_at=now() where id=p_listing_id and owner_id=p_user_id;
  if not found then raise exception 'MARKETPLACE_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('id',p_listing_id,'withdrawn',true);
end; $$;

create or replace function public.marketplace_list(p_limit integer default 20, p_offset integer default 0, p_search text default '', p_category text default null, p_audience text default null, p_allow_adult boolean default false, p_user_id uuid default null)
returns setof jsonb language sql security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'id', l.id, 'name', case when v.adult_only and not p_allow_adult then 'R18のテーマ' else v.name end,
    'description', case when v.adult_only and not p_allow_adult then '' else v.description end,
    'publisherName', case when v.adult_only and not p_allow_adult then '非公開' else v.publisher_name end,
    'category', v.category, 'audience', v.audience, 'questionOrder', v.question_order,
    'adult', v.adult_only, 'cardCount', v.card_count, 'versionId', v.id,
    'importCount', (select count(distinct i.user_id) from public.marketplace_imports i where i.listing_id=l.id),
    'likeCount', (select count(*) from public.marketplace_likes k where k.listing_id=l.id),
    'importedByMe', case when p_user_id is null then false else exists(select 1 from public.marketplace_imports i where i.listing_id=l.id and i.user_id=p_user_id and i.imported_set_id is not null) end,
    'likedByMe', case when p_user_id is null then false else exists(select 1 from public.marketplace_likes k where k.listing_id=l.id and k.user_id=p_user_id) end
  )
  from public.marketplace_listings l join public.marketplace_versions v on v.id=l.current_version_id
  where l.withdrawn_at is null and (not v.adult_only or (p_allow_adult and p_user_id is not null and public.is_adult_confirmed(p_user_id)))
    and (p_category is null or v.category=p_category) and (p_audience is null or v.audience=p_audience)
    and (coalesce(p_search,'')='' or (v.name ilike '%'||left(p_search,80)||'%' or v.description ilike '%'||left(p_search,80)||'%'))
  order by l.updated_at desc limit least(greatest(coalesce(p_limit,20),1),24) offset greatest(coalesce(p_offset,0),0);
$$;

create or replace function public.marketplace_detail(p_listing_id uuid, p_allow_adult boolean default false, p_user_id uuid default null)
returns jsonb language sql security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'id', l.id, 'name', case when v.adult_only and not p_allow_adult then 'R18のテーマ' else v.name end,
    'description', case when v.adult_only and not p_allow_adult then '' else v.description end,
    'publisherName', case when v.adult_only and not p_allow_adult then '非公開' else v.publisher_name end,
    'category', v.category, 'audience', v.audience, 'questionOrder', v.question_order,
    'adult', v.adult_only, 'cardCount', v.card_count, 'versionId', v.id,
    'preview', case when v.adult_only and not p_allow_adult then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('text',x.value->>'text','r18',coalesce((x.value->>'r18')::boolean,false)) order by x.ord), '[]'::jsonb) from jsonb_array_elements(v.cards) with ordinality x(value,ord) where x.ord <= 3) end,
    'importCount', (select count(distinct i.user_id) from public.marketplace_imports i where i.listing_id=l.id),
    'likeCount', (select count(*) from public.marketplace_likes k where k.listing_id=l.id),
    'importedByMe', case when p_user_id is null then false else exists(select 1 from public.marketplace_imports i where i.listing_id=l.id and i.user_id=p_user_id and i.imported_set_id is not null) end,
    'likedByMe', case when p_user_id is null then false else exists(select 1 from public.marketplace_likes k where k.listing_id=l.id and k.user_id=p_user_id) end
  ) from public.marketplace_listings l join public.marketplace_versions v on v.id=l.current_version_id where l.id=p_listing_id and l.withdrawn_at is null and (not v.adult_only or (p_allow_adult and p_user_id is not null and public.is_adult_confirmed(p_user_id)));
$$;

create or replace function public.marketplace_owner_list(p_user_id uuid, p_allow_adult boolean default false)
returns setof jsonb language sql security definer set search_path = public, auth as $$
  select jsonb_build_object('id',l.id,'sourceSetId',l.source_set_id,'withdrawn',l.withdrawn_at is not null,'updatedAt',l.updated_at,'version',v.version,'name',case when v.adult_only and not p_allow_adult then 'R18のテーマ' else v.name end,'description',case when v.adult_only and not p_allow_adult then '' else v.description end,'publisherName',v.publisher_name,'category',v.category,'audience',v.audience,'questionOrder',v.question_order,'adult',v.adult_only,'cardCount',v.card_count,'importCount',(select count(distinct i.user_id) from public.marketplace_imports i where i.listing_id=l.id),'likeCount',(select count(*) from public.marketplace_likes k where k.listing_id=l.id))
  from public.marketplace_listings l join public.marketplace_versions v on v.id=l.current_version_id where l.owner_id=p_user_id and (not v.adult_only or (p_allow_adult and public.is_adult_confirmed(p_user_id))) order by l.updated_at desc;
$$;

revoke all on table public.marketplace_listings, public.marketplace_versions, public.marketplace_imports, public.marketplace_likes from anon, authenticated;
revoke all on function public.marketplace_publish(uuid,uuid,text,text,text,text,text,text,boolean,boolean,jsonb), public.marketplace_import(uuid,uuid,boolean), public.marketplace_like(uuid,uuid,boolean,boolean), public.marketplace_withdraw(uuid,uuid), public.marketplace_list(integer,integer,text,text,text,boolean,uuid), public.marketplace_detail(uuid,boolean,uuid), public.marketplace_owner_list(uuid,boolean) from public, anon, authenticated;
grant all on table public.marketplace_listings, public.marketplace_versions, public.marketplace_imports, public.marketplace_likes to service_role;
grant execute on function public.marketplace_publish(uuid,uuid,text,text,text,text,text,text,boolean,boolean,jsonb), public.marketplace_import(uuid,uuid,boolean), public.marketplace_like(uuid,uuid,boolean,boolean), public.marketplace_withdraw(uuid,uuid), public.marketplace_list(integer,integer,text,text,text,boolean,uuid), public.marketplace_detail(uuid,boolean,uuid), public.marketplace_owner_list(uuid,boolean) to service_role;
commit;
