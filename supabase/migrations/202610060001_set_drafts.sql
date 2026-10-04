-- Private, editable set drafts. Existing my_sets remains a ready 6-40 card table.
create table if not exists public.my_set_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_set_id uuid references public.my_sets(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 0 and 40),
  status text not null default 'draft' check (status = 'draft'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists my_set_drafts_user_updated_idx on public.my_set_drafts(user_id, updated_at desc);
create unique index if not exists my_set_drafts_one_source_idx on public.my_set_drafts(user_id, source_set_id) where source_set_id is not null;

alter table public.my_set_drafts enable row level security;
drop policy if exists my_set_drafts_owner_select on public.my_set_drafts;
create policy my_set_drafts_owner_select on public.my_set_drafts for select using (auth.uid() = user_id);
drop policy if exists my_set_drafts_owner_insert on public.my_set_drafts;
create policy my_set_drafts_owner_insert on public.my_set_drafts for insert with check (auth.uid() = user_id);
drop policy if exists my_set_drafts_owner_update on public.my_set_drafts;
create policy my_set_drafts_owner_update on public.my_set_drafts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists my_set_drafts_owner_delete on public.my_set_drafts;
create policy my_set_drafts_owner_delete on public.my_set_drafts for delete using (auth.uid() = user_id);

create or replace function public.set_my_set_drafts_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists my_set_drafts_updated_at on public.my_set_drafts;
create trigger my_set_drafts_updated_at before update on public.my_set_drafts for each row execute function public.set_my_set_drafts_updated_at();

-- Keep the nullable source relationship owner-scoped even for direct REST writes.
create or replace function public.validate_my_set_draft_row() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare item jsonb; kind text; item_text text; item_id text; saved_ids text[] := '{}'; custom_texts text[] := '{}';
begin
  if new.source_set_id is not null and not exists (
    select 1 from public.my_sets s where s.id = new.source_set_id and s.user_id = new.user_id
  ) then raise exception 'DRAFT_SOURCE_NOT_OWNED' using errcode = '42501'; end if;
  for item in select value from jsonb_array_elements(new.items) as value loop
    kind := item->>'kind';
    if jsonb_typeof(item) <> 'object' then raise exception 'DRAFT_ITEM_INVALID' using errcode = '22023';
    elsif kind = 'saved' then
      if (select count(*) from jsonb_object_keys(item)) <> 2 or item ? 'cardId' is not true or item ? 'kind' is not true or jsonb_typeof(item->'cardId') <> 'string' then raise exception 'DRAFT_ITEM_INVALID' using errcode = '22023'; end if;
      item_id := item->>'cardId';
      if item_id = any(saved_ids) then raise exception 'DRAFT_CARD_DUPLICATE' using errcode = '22023'; end if;
      if left(item_id, 7) = 'custom:' then
        if item_id !~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'DRAFT_ITEM_INVALID' using errcode = '22023'; end if;
        perform pg_advisory_xact_lock(hashtextextended('custom-card:' || substring(item_id from 8), 0));
        if not exists (select 1 from public.custom_cards c where ('custom:' || c.id::text) = item_id and c.user_id = new.user_id) then raise exception 'DRAFT_CARD_NOT_OWNED' using errcode = '42501'; end if;
      end if;
      saved_ids := array_append(saved_ids, item_id);
    elsif kind = 'custom' then
      item_text := btrim(item->>'text');
      if (select count(*) from jsonb_object_keys(item)) <> 4 or item ? 'kind' is not true or item ? 'text' is not true or item ? 'r18' is not true or item ? 'origin' is not true or jsonb_typeof(item->'text') <> 'string' or jsonb_typeof(item->'r18') <> 'boolean' or jsonb_typeof(item->'origin') <> 'string' or item->>'origin' not in ('user','ai') or item_text is null or char_length(item_text) not between 1 and 300 or item->>'text' <> item_text or item_text ~ '[[:cntrl:]]' or strpos(item_text, chr(8232)) > 0 or strpos(item_text, chr(8233)) > 0 then raise exception 'DRAFT_ITEM_INVALID' using errcode = '22023'; end if;
      if item_text = any(custom_texts) then raise exception 'DRAFT_CARD_DUPLICATE' using errcode = '22023'; end if;
      custom_texts := array_append(custom_texts, item_text);
    else raise exception 'DRAFT_ITEM_INVALID' using errcode = '22023'; end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists my_set_drafts_validate on public.my_set_drafts;
create trigger my_set_drafts_validate before insert or update on public.my_set_drafts for each row execute function public.validate_my_set_draft_row();

-- A saved custom card referenced by a draft is in use too. Keep the existing
-- custom-card delete trigger's advisory lock and extend its guard to drafts.
create or replace function public.prevent_custom_card_delete_if_used() returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('custom-card:' || old.id::text, 0));
  if auth.uid() is not null and (exists (select 1 from public.my_sets s where s.user_id = old.user_id and ('custom:' || old.id::text) = any(s.card_ids))
     or exists (select 1 from public.my_set_drafts d, jsonb_array_elements(d.items) as item where d.user_id = old.user_id and item->>'kind' = 'saved' and item->>'cardId' = ('custom:' || old.id::text))) then
    raise exception 'CARD_IN_USE' using errcode = '23514';
  end if;
  return old;
end;
$$;

-- Completes a draft atomically. The API performs the static catalog check; this
-- function repeats ownership, shape, custom-card and ready-set checks inside
-- the transaction so direct authenticated RPC calls cannot create short sets.
drop function if exists public.complete_my_set_draft(uuid);
create or replace function public.complete_my_set_draft(p_draft_id uuid, p_user_id uuid, p_expected_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public, auth as $$
declare d public.my_set_drafts%rowtype; source_owner uuid; item jsonb; kind text; card_id text; item_text text; item_r18 boolean; origin text; ids text[] := '{}'; seen_text text[] := '{}'; new_card_id uuid; target_id uuid;
begin
  if p_user_id is null or p_expected_items is null or jsonb_typeof(p_expected_items) <> 'array' then raise exception 'DRAFT_ITEM_INVALID' using errcode = '22023'; end if;
  select * into d from public.my_set_drafts where id = p_draft_id and user_id = p_user_id and status = 'draft' for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.items is distinct from p_expected_items then raise exception 'DRAFT_CHANGED' using errcode = '40001'; end if;
  if jsonb_array_length(d.items) < 6 or jsonb_array_length(d.items) > 40 then raise exception 'DRAFT_NEEDS_SIX_CARDS' using errcode = '22023'; end if;
  if d.source_set_id is not null then
    select user_id into source_owner from public.my_sets where id = d.source_set_id for update;
    if source_owner is distinct from p_user_id then raise exception 'DRAFT_SOURCE_NOT_OWNED' using errcode = '42501'; end if;
    target_id := d.source_set_id;
  end if;
  for item in select value from jsonb_array_elements(d.items) as value loop
    kind := item->>'kind';
    if kind = 'saved' then
      card_id := item->>'cardId';
      if card_id is null or card_id = any(ids) then raise exception 'DRAFT_CARD_DUPLICATE' using errcode = '22023'; end if;
      if left(card_id, 7) = 'custom:' then
        if not exists (select 1 from public.custom_cards c where ('custom:' || c.id::text) = card_id and c.user_id = p_user_id) then raise exception 'DRAFT_CARD_NOT_OWNED' using errcode = '42501'; end if;
      end if;
      ids := array_append(ids, card_id);
    elsif kind = 'custom' then
      if item ? 'text' is not true or item ? 'r18' is not true or item ? 'origin' is not true or jsonb_typeof(item->'text') <> 'string' or jsonb_typeof(item->'r18') <> 'boolean' or jsonb_typeof(item->'origin') <> 'string' then raise exception 'DRAFT_CUSTOM_INVALID' using errcode = '22023'; end if;
      item_text := btrim(item->>'text'); item_r18 := (item->>'r18')::boolean; origin := item->>'origin';
      if item_text is null or char_length(item_text) < 1 or char_length(item_text) > 300 or item->>'text' <> item_text or item_text ~ '[[:cntrl:]]' or strpos(item_text, chr(8232)) > 0 or strpos(item_text, chr(8233)) > 0 or origin not in ('user','ai') then raise exception 'DRAFT_CUSTOM_INVALID' using errcode = '22023'; end if;
      if item_text = any(seen_text) then raise exception 'DRAFT_CARD_DUPLICATE' using errcode = '22023'; end if;
      insert into public.custom_cards(user_id, text, r18) values (p_user_id, item_text, item_r18) returning id into new_card_id;
      ids := array_append(ids, 'custom:' || new_card_id::text); seen_text := array_append(seen_text, item_text);
    else raise exception 'DRAFT_ITEM_INVALID' using errcode = '22023'; end if;
  end loop;
  if cardinality(ids) < 6 or cardinality(ids) > 40 then raise exception 'DRAFT_NEEDS_SIX_CARDS' using errcode = '22023'; end if;
  if target_id is null then
    insert into public.my_sets(user_id, name, card_ids) values (p_user_id, btrim(d.name), ids) returning id into target_id;
  else
    update public.my_sets set name = btrim(d.name), card_ids = ids where id = target_id and user_id = p_user_id;
  end if;
  delete from public.my_set_drafts where id = d.id and user_id = p_user_id;
  return jsonb_build_object('id', target_id, 'name', btrim(d.name), 'card_ids', to_jsonb(ids));
exception when others then
  raise;
end;
$$;
revoke all on function public.complete_my_set_draft(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_my_set_draft(uuid, uuid, jsonb) to service_role;
