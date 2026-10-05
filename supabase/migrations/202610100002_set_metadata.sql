-- Set metadata is additive and defaults to the existing group/shuffle behavior.
alter table public.my_sets add column if not exists audience text not null default 'group';
alter table public.my_sets add column if not exists question_order text not null default 'shuffle';
alter table public.my_set_drafts add column if not exists audience text not null default 'group';
alter table public.my_set_drafts add column if not exists question_order text not null default 'shuffle';
alter table public.my_sets drop constraint if exists my_sets_audience_check;
alter table public.my_sets add constraint my_sets_audience_check check (audience in ('group', 'solo', 'both'));
alter table public.my_sets drop constraint if exists my_sets_question_order_check;
alter table public.my_sets add constraint my_sets_question_order_check check (question_order in ('shuffle', 'fixed'));
alter table public.my_set_drafts drop constraint if exists my_set_drafts_audience_check;
alter table public.my_set_drafts add constraint my_set_drafts_audience_check check (audience in ('group', 'solo', 'both'));
alter table public.my_set_drafts drop constraint if exists my_set_drafts_question_order_check;
alter table public.my_set_drafts add constraint my_set_drafts_question_order_check check (question_order in ('shuffle', 'fixed'));

-- Preserve ordering metadata in share snapshots and reject solo-only sharing at
-- the database boundary, including direct RPC calls that bypass the API.
alter table public.shared_sets add column if not exists question_order text not null default 'shuffle';
alter table public.shared_sets drop constraint if exists shared_sets_question_order_check;
alter table public.shared_sets add constraint shared_sets_question_order_check check (question_order in ('shuffle', 'fixed'));
create or replace function public.set_shared_set_metadata() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare set_audience text; set_order text;
begin
  select audience, question_order into set_audience, set_order from public.my_sets where id = new.set_id and user_id = new.owner_id;
  if set_audience = 'solo' then raise exception 'SOLO_ONLY_SOURCE' using errcode = '22023'; end if;
  new.question_order := coalesce(set_order, 'shuffle');
  return new;
end;
$$;
drop trigger if exists shared_sets_metadata_guard on public.shared_sets;
create trigger shared_sets_metadata_guard before insert on public.shared_sets for each row execute function public.set_shared_set_metadata();

-- Replace the original three-argument RPC directly. The body mirrors the
-- original completion validation and carries locked draft metadata atomically.
drop function if exists public.complete_my_set_draft(uuid, uuid, jsonb, text, text);
create or replace function public.complete_my_set_draft(p_draft_id uuid, p_user_id uuid, p_expected_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public, auth as $$
declare d public.my_set_drafts%rowtype; source_owner uuid; item jsonb; kind text; card_id text; item_text text; item_r18 boolean; origin text; ids text[] := '{}'; seen_text text[] := '{}'; new_card_id uuid; target_id uuid;
begin
  if p_user_id is null or p_expected_items is null or jsonb_typeof(p_expected_items) <> 'array' then raise exception 'DRAFT_ITEM_INVALID' using errcode = '22023'; end if;
  select * into d from public.my_set_drafts where id = p_draft_id and user_id = p_user_id and status = 'draft' for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.items is distinct from p_expected_items then raise exception 'DRAFT_CHANGED' using errcode = '40001'; end if;
  if jsonb_array_length(d.items) < 6 or jsonb_array_length(d.items) > 40 then raise exception 'DRAFT_NEEDS_SIX_CARDS' using errcode = '22023'; end if;
  if d.source_set_id is not null then select user_id into source_owner from public.my_sets where id = d.source_set_id for update; if source_owner is distinct from p_user_id then raise exception 'DRAFT_SOURCE_NOT_OWNED' using errcode = '42501'; end if; target_id := d.source_set_id; end if;
  for item in select value from jsonb_array_elements(d.items) as value loop
    kind := item->>'kind';
    if kind = 'saved' then
      card_id := item->>'cardId'; if card_id is null or card_id = any(ids) then raise exception 'DRAFT_CARD_DUPLICATE' using errcode = '22023'; end if;
      if left(card_id, 7) = 'custom:' and not exists (select 1 from public.custom_cards c where ('custom:' || c.id::text) = card_id and c.user_id = p_user_id) then raise exception 'DRAFT_CARD_NOT_OWNED' using errcode = '42501'; end if;
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
  if target_id is null then insert into public.my_sets(user_id, name, card_ids, audience, question_order) values (p_user_id, btrim(d.name), ids, d.audience, d.question_order) returning id into target_id;
  else update public.my_sets set name = btrim(d.name), card_ids = ids, audience = d.audience, question_order = d.question_order where id = target_id and user_id = p_user_id; end if;
  delete from public.my_set_drafts where id = d.id and user_id = p_user_id;
  return jsonb_build_object('id', target_id, 'name', btrim(d.name), 'card_ids', to_jsonb(ids), 'audience', d.audience, 'question_order', d.question_order);
end;
$$;
revoke all on function public.complete_my_set_draft(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_my_set_draft(uuid, uuid, jsonb) to service_role;
