-- Creator set metadata. theme_r18 is the explicit theme choice; adult_only
-- remains the effective snapshot value (theme_r18 OR any child card.r18).
begin;

alter table public.my_sets add column if not exists theme_r18 boolean not null default false;
alter table public.my_sets add column if not exists design jsonb;
alter table public.my_set_drafts add column if not exists theme_r18 boolean not null default false;
alter table public.my_set_drafts add column if not exists design jsonb;
alter table public.marketplace_versions add column if not exists theme_r18 boolean not null default false;
alter table public.marketplace_versions add column if not exists design jsonb;
alter table public.shared_sets add column if not exists design jsonb;

alter table public.my_sets drop constraint if exists my_sets_design_check;
alter table public.my_sets add constraint my_sets_design_check check (
  design is null or (
    jsonb_typeof(design) = 'object' and
    (design ? 'version') is true and (design ? 'kind') is true and (design ? 'presetId') is true and
    jsonb_typeof(design->'version') = 'number' and (design->'version')::numeric = 1 and (design->>'kind' = 'preset') is true and
    (design->>'presetId' in ('first-meeting','relationships','friends','work-future','self-reflection','adult-conversation','love','sports')) is true
  )
);
alter table public.my_set_drafts drop constraint if exists my_set_drafts_design_check;
alter table public.my_set_drafts add constraint my_set_drafts_design_check check (
  design is null or (
    jsonb_typeof(design) = 'object' and
    (design ? 'version') is true and (design ? 'kind') is true and (design ? 'presetId') is true and
    jsonb_typeof(design->'version') = 'number' and (design->'version')::numeric = 1 and (design->>'kind' = 'preset') is true and
    (design->>'presetId' in ('first-meeting','relationships','friends','work-future','self-reflection','adult-conversation','love','sports')) is true
  )
);
alter table public.marketplace_versions drop constraint if exists marketplace_versions_design_check;
alter table public.marketplace_versions add constraint marketplace_versions_design_check check (
  design is null or (
    jsonb_typeof(design) = 'object' and
    (design ? 'version') is true and (design ? 'kind') is true and (design ? 'presetId') is true and
    jsonb_typeof(design->'version') = 'number' and (design->'version')::numeric = 1 and (design->>'kind' = 'preset') is true and
    (design->>'presetId' in ('first-meeting','relationships','friends','work-future','self-reflection','adult-conversation','love','sports')) is true
  )
);
alter table public.shared_sets drop constraint if exists shared_sets_design_check;
alter table public.shared_sets add constraint shared_sets_design_check check (
  design is null or (
    jsonb_typeof(design) = 'object' and
    (design ? 'version') is true and (design ? 'kind') is true and (design ? 'presetId') is true and
    jsonb_typeof(design->'version') = 'number' and (design->'version')::numeric = 1 and (design->>'kind' = 'preset') is true and
    (design->>'presetId' in ('first-meeting','relationships','friends','work-future','self-reflection','adult-conversation','love','sports')) is true
  )
);

alter table public.venue_sets add column if not exists design jsonb;
alter table public.group_rooms add column if not exists design jsonb;
alter table public.venue_sets drop constraint if exists venue_sets_design_check;
alter table public.venue_sets add constraint venue_sets_design_check check (
  design is null or (jsonb_typeof(design) = 'object' and (design ? 'version') is true and (design ? 'kind') is true and (design ? 'presetId') is true and jsonb_typeof(design->'version') = 'number' and (design->'version')::numeric = 1 and (design->>'kind' = 'preset') is true and (design->>'presetId' in ('first-meeting','relationships','friends','work-future','self-reflection','adult-conversation','love','sports')) is true)
);
alter table public.group_rooms drop constraint if exists group_rooms_design_check;
alter table public.group_rooms add constraint group_rooms_design_check check (
  design is null or (jsonb_typeof(design) = 'object' and (design ? 'version') is true and (design ? 'kind') is true and (design ? 'presetId') is true and jsonb_typeof(design->'version') = 'number' and (design->'version')::numeric = 1 and (design->>'kind' = 'preset') is true and (design->>'presetId' in ('first-meeting','relationships','friends','work-future','self-reflection','adult-conversation','love','sports')) is true)
);
create or replace function public.set_group_room_creator_metadata() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare source_design jsonb; source_theme boolean; cards_adult boolean;
begin
  begin
    select s.design,s.theme_r18 into source_design,source_theme from public.my_sets s where s.id = new.deck_id::uuid and s.user_id = new.host_user_id;
  exception when invalid_text_representation then source_design := null; source_theme := false;
  end;
  new.design := source_design;
  select coalesce(bool_or(coalesce((x.value->>'r18')::boolean,false)),false) into cards_adult from jsonb_array_elements(new.cards) x;
  new.adult_only := coalesce(new.adult_only,false) or coalesce(source_theme,false) or cards_adult;
  return new;
end;
$$;
drop trigger if exists group_room_creator_metadata on public.group_rooms;
create trigger group_room_creator_metadata before insert on public.group_rooms for each row execute function public.set_group_room_creator_metadata();

create or replace function public.marketplace_publish(
  p_user_id uuid, p_set_id uuid, p_name text, p_description text, p_category text,
  p_publisher_name text, p_audience text, p_question_order text,
  p_adult_only boolean, p_allow_adult boolean, p_cards jsonb
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare s public.my_sets%rowtype; l public.marketplace_listings%rowtype; v public.marketplace_versions%rowtype;
  ids text[]; supplied text[]; next_version integer; item jsonb; cards_adult boolean; effective_adult boolean;
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
  select array_agg(value->>'id' order by ord) into supplied from jsonb_array_elements(p_cards) with ordinality as x(value,ord);
  if supplied is distinct from ids then raise exception 'SOURCE_CARDS_CHANGED' using errcode='40001'; end if;
  select coalesce(bool_or(coalesce((x.value->>'r18')::boolean,false)),false) into cards_adult from jsonb_array_elements(p_cards) x;
  effective_adult := cards_adult or coalesce(s.theme_r18,false);
  if p_adult_only is distinct from effective_adult then raise exception 'ADULT_METADATA_INVALID' using errcode='22023'; end if;
  if effective_adult and (p_allow_adult is not true or not public.is_adult_confirmed(p_user_id)) then raise exception 'AGE_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  select * into l from public.marketplace_listings where owner_id=p_user_id and source_set_id=p_set_id for update;
  if not found then insert into public.marketplace_listings(owner_id,source_set_id) values(p_user_id,p_set_id) returning * into l; end if;
  select coalesce(max(version),0)+1 into next_version from public.marketplace_versions where listing_id=l.id;
  insert into public.marketplace_versions(listing_id,version,name,description,category,audience,question_order,adult_only,theme_r18,design,publisher_name,cards,card_count)
    values(l.id,next_version,btrim(p_name),btrim(p_description),p_category,p_audience,p_question_order,effective_adult,coalesce(s.theme_r18,false),s.design,btrim(p_publisher_name),p_cards,jsonb_array_length(p_cards)) returning * into v;
  update public.marketplace_listings set current_version_id=v.id, withdrawn_at=null, updated_at=now() where id=l.id returning * into l;
  return jsonb_build_object('listingId',l.id,'versionId',v.id,'version',v.version);
end; $$;

create or replace function public.marketplace_import(p_user_id uuid, p_listing_id uuid, p_allow_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare l public.marketplace_listings%rowtype; v public.marketplace_versions%rowtype; old public.marketplace_imports%rowtype; item jsonb; ids text[] := '{}'; new_id uuid; name text;
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
  insert into public.my_sets(user_id,name,card_ids,audience,question_order,theme_r18,design) values(p_user_id,name,ids,v.audience,v.question_order,v.theme_r18,v.design) returning id into new_id;
  insert into public.marketplace_imports(listing_id,user_id,version_id,imported_set_id) values(l.id,p_user_id,v.id,new_id)
    on conflict(listing_id,user_id) do update set version_id=excluded.version_id, imported_set_id=excluded.imported_set_id, updated_at=now();
  return jsonb_build_object('setId',new_id,'imported',true,'versionId',v.id);
end; $$;

-- Keep the original invoker RPC and return signature. The existing trigger
-- calls this function before insert, so it is the single metadata boundary.
create or replace function public.set_shared_set_metadata() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare set_audience text; set_order text; set_design jsonb; set_theme_r18 boolean; cards_adult boolean;
begin
  select audience,question_order,design,theme_r18 into set_audience,set_order,set_design,set_theme_r18 from public.my_sets where id=new.set_id and user_id=new.owner_id;
  if set_audience = 'solo' then raise exception 'SOLO_ONLY_SOURCE' using errcode = '22023'; end if;
  new.question_order := coalesce(set_order,'shuffle');
  new.design := set_design;
  select coalesce(bool_or(coalesce((x.value->>'r18')::boolean,false)),false) into cards_adult from jsonb_array_elements(new.cards) x;
  new.adult_only := coalesce(new.adult_only,false) or coalesce(set_theme_r18,false) or cards_adult;
  if new.adult_only and not public.is_adult_confirmed(new.owner_id) then raise exception 'AGE_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  return new;
end;
$$;

-- Draft completion carries the draft's explicit flag and descriptor atomically.
create or replace function public.complete_my_set_draft(p_draft_id uuid,p_user_id uuid,p_expected_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public, auth as $$
declare d public.my_set_drafts%rowtype; source_owner uuid; item jsonb; kind text; card_id text; item_text text; item_r18 boolean; origin text; ids text[] := '{}'; seen_text text[] := '{}'; new_card_id uuid; target_id uuid; effective_adult boolean := false;
begin
  if p_user_id is null or p_expected_items is null or jsonb_typeof(p_expected_items) <> 'array' then raise exception 'DRAFT_ITEM_INVALID' using errcode='22023'; end if;
  select * into d from public.my_set_drafts where id=p_draft_id and user_id=p_user_id and status='draft' for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0002'; end if;
  if d.items is distinct from p_expected_items then raise exception 'DRAFT_CHANGED' using errcode='40001'; end if;
  if jsonb_array_length(d.items)<6 or jsonb_array_length(d.items)>40 then raise exception 'DRAFT_NEEDS_SIX_CARDS' using errcode='22023'; end if;
  if d.source_set_id is not null then select user_id into source_owner from public.my_sets where id=d.source_set_id for update; if source_owner is distinct from p_user_id then raise exception 'DRAFT_SOURCE_NOT_OWNED' using errcode='42501'; end if; target_id:=d.source_set_id; end if;
  for item in select value from jsonb_array_elements(d.items) as value loop
    kind:=item->>'kind';
    if kind='saved' then card_id:=item->>'cardId'; if card_id is null or card_id=any(ids) then raise exception 'DRAFT_CARD_DUPLICATE' using errcode='22023'; end if; if left(card_id,7)='custom:' then select c.r18 into item_r18 from public.custom_cards c where ('custom:'||c.id::text)=card_id and c.user_id=p_user_id; if not found then raise exception 'DRAFT_CARD_NOT_OWNED' using errcode='42501'; end if; effective_adult := effective_adult or coalesce(item_r18,false); end if; ids:=array_append(ids,card_id);
    elsif kind='custom' then
      if item ? 'text' is not true or item ? 'r18' is not true or item ? 'origin' is not true or jsonb_typeof(item->'text')<>'string' or jsonb_typeof(item->'r18')<>'boolean' or jsonb_typeof(item->'origin')<>'string' then raise exception 'DRAFT_CUSTOM_INVALID' using errcode='22023'; end if;
      item_text:=btrim(item->>'text'); item_r18:=(item->>'r18')::boolean; origin:=item->>'origin'; if item_text is null or char_length(item_text)<1 or char_length(item_text)>300 or item->>'text'<>item_text or item_text~'[[:cntrl:]]' or strpos(item_text,chr(8232))>0 or strpos(item_text,chr(8233))>0 or origin not in ('user','ai') then raise exception 'DRAFT_CUSTOM_INVALID' using errcode='22023'; end if; effective_adult := effective_adult or item_r18;
      if item_text=any(seen_text) then raise exception 'DRAFT_CARD_DUPLICATE' using errcode='22023'; end if; insert into public.custom_cards(user_id,text,r18) values(p_user_id,item_text,item_r18) returning id into new_card_id; ids:=array_append(ids,'custom:'||new_card_id::text); seen_text:=array_append(seen_text,item_text);
    else raise exception 'DRAFT_ITEM_INVALID' using errcode='22023'; end if;
  end loop;
  effective_adult := effective_adult or coalesce(d.theme_r18,false); if effective_adult and not public.is_adult_confirmed(p_user_id) then raise exception 'AGE_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  if cardinality(ids)<6 or cardinality(ids)>40 then raise exception 'DRAFT_NEEDS_SIX_CARDS' using errcode='22023'; end if;
  if target_id is null then insert into public.my_sets(user_id,name,card_ids,audience,question_order,theme_r18,design) values(p_user_id,btrim(d.name),ids,d.audience,d.question_order,d.theme_r18,d.design) returning id into target_id; else update public.my_sets set name=btrim(d.name),card_ids=ids,audience=d.audience,question_order=d.question_order,theme_r18=d.theme_r18,design=d.design where id=target_id and user_id=p_user_id; end if;
  delete from public.my_set_drafts where id=d.id and user_id=p_user_id;
  return jsonb_build_object('id',target_id,'name',btrim(d.name),'card_ids',to_jsonb(ids),'audience',d.audience,'question_order',d.question_order,'theme_r18',d.theme_r18,'design',d.design);
end; $$;

-- Add metadata without exposing private adult content to unconfirmed viewers.
create or replace function public.marketplace_list(p_limit integer default 20,p_offset integer default 0,p_search text default '',p_category text default null,p_audience text default null,p_allow_adult boolean default false,p_user_id uuid default null)
returns setof jsonb language sql security definer set search_path=public,auth as $$
select jsonb_build_object('id',l.id,'name',case when v.adult_only and not p_allow_adult then 'R18のテーマ' else v.name end,'description',case when v.adult_only and not p_allow_adult then '' else v.description end,'publisherName',case when v.adult_only and not p_allow_adult then '非公開' else v.publisher_name end,'category',v.category,'audience',v.audience,'questionOrder',v.question_order,'adult',v.adult_only,'themeR18',v.theme_r18,'design',v.design,'cardCount',v.card_count,'versionId',v.id,'importCount',(select count(distinct i.user_id) from public.marketplace_imports i where i.listing_id=l.id),'likeCount',(select count(*) from public.marketplace_likes k where k.listing_id=l.id),'importedByMe',case when p_user_id is null then false else exists(select 1 from public.marketplace_imports i where i.listing_id=l.id and i.user_id=p_user_id and i.imported_set_id is not null) end,'likedByMe',case when p_user_id is null then false else exists(select 1 from public.marketplace_likes k where k.listing_id=l.id and k.user_id=p_user_id) end)
from public.marketplace_listings l join public.marketplace_versions v on v.id=l.current_version_id
where l.withdrawn_at is null and (not v.adult_only or (p_allow_adult and p_user_id is not null and public.is_adult_confirmed(p_user_id))) and (p_category is null or v.category=p_category) and (p_audience is null or v.audience=p_audience) and (coalesce(p_search,'')='' or (v.name ilike '%'||left(p_search,80)||'%' or v.description ilike '%'||left(p_search,80)||'%')) order by l.updated_at desc limit least(greatest(coalesce(p_limit,20),1),24) offset greatest(coalesce(p_offset,0),0);
$$;

create or replace function public.marketplace_detail(p_listing_id uuid,p_allow_adult boolean default false,p_user_id uuid default null)
returns jsonb language sql security definer set search_path=public,auth as $$
select jsonb_build_object('id',l.id,'name',case when v.adult_only and not p_allow_adult then 'R18のテーマ' else v.name end,'description',case when v.adult_only and not p_allow_adult then '' else v.description end,'publisherName',case when v.adult_only and not p_allow_adult then '非公開' else v.publisher_name end,'category',v.category,'audience',v.audience,'questionOrder',v.question_order,'adult',v.adult_only,'themeR18',v.theme_r18,'design',v.design,'cardCount',v.card_count,'versionId',v.id,'preview',case when v.adult_only and not p_allow_adult then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('text',x.value->>'text','r18',coalesce((x.value->>'r18')::boolean,false)) order by x.ord),'[]'::jsonb) from jsonb_array_elements(v.cards) with ordinality x(value,ord) where x.ord<=3) end,'importCount',(select count(distinct i.user_id) from public.marketplace_imports i where i.listing_id=l.id),'likeCount',(select count(*) from public.marketplace_likes k where k.listing_id=l.id),'importedByMe',case when p_user_id is null then false else exists(select 1 from public.marketplace_imports i where i.listing_id=l.id and i.user_id=p_user_id and i.imported_set_id is not null) end,'likedByMe',case when p_user_id is null then false else exists(select 1 from public.marketplace_likes k where k.listing_id=l.id and k.user_id=p_user_id) end)
from public.marketplace_listings l join public.marketplace_versions v on v.id=l.current_version_id where l.id=p_listing_id and l.withdrawn_at is null and (not v.adult_only or (p_allow_adult and p_user_id is not null and public.is_adult_confirmed(p_user_id)));
$$;

create or replace function public.marketplace_owner_list(p_user_id uuid,p_allow_adult boolean default false)
returns setof jsonb language sql security definer set search_path=public,auth as $$
select jsonb_build_object('id',l.id,'sourceSetId',l.source_set_id,'withdrawn',l.withdrawn_at is not null,'updatedAt',l.updated_at,'version',v.version,'name',case when v.adult_only and not p_allow_adult then 'R18のテーマ' else v.name end,'description',case when v.adult_only and not p_allow_adult then '' else v.description end,'publisherName',v.publisher_name,'category',v.category,'audience',v.audience,'questionOrder',v.question_order,'adult',v.adult_only,'themeR18',v.theme_r18,'design',v.design,'cardCount',v.card_count,'importCount',(select count(distinct i.user_id) from public.marketplace_imports i where i.listing_id=l.id),'likeCount',(select count(*) from public.marketplace_likes k where k.listing_id=l.id))
from public.marketplace_listings l join public.marketplace_versions v on v.id=l.current_version_id where l.owner_id=p_user_id and (not v.adult_only or (p_allow_adult and public.is_adult_confirmed(p_user_id))) order by l.updated_at desc;
$$;

revoke all on function public.marketplace_publish(uuid,uuid,text,text,text,text,text,text,boolean,boolean,jsonb),public.marketplace_import(uuid,uuid,boolean),public.marketplace_list(integer,integer,text,text,text,boolean,uuid),public.marketplace_detail(uuid,boolean,uuid),public.marketplace_owner_list(uuid,boolean),public.complete_my_set_draft(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketplace_publish(uuid,uuid,text,text,text,text,text,text,boolean,boolean,jsonb),public.marketplace_import(uuid,uuid,boolean),public.marketplace_list(integer,integer,text,text,text,boolean,uuid),public.marketplace_detail(uuid,boolean,uuid),public.marketplace_owner_list(uuid,boolean),public.complete_my_set_draft(uuid,uuid,jsonb) to service_role;
commit;
