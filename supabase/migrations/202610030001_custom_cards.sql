create table if not exists public.custom_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (text = btrim(text) and char_length(text) between 1 and 300 and text !~ E'[\\u0000-\\u001f\\u007f\\u2028\\u2029]'),
  r18 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists custom_cards_user_created_idx on public.custom_cards(user_id, created_at);
alter table public.custom_cards enable row level security;
drop policy if exists custom_cards_owner_select on public.custom_cards;
create policy custom_cards_owner_select on public.custom_cards for select using (auth.uid() = user_id);
drop policy if exists custom_cards_owner_insert on public.custom_cards;
create policy custom_cards_owner_insert on public.custom_cards for insert with check (auth.uid() = user_id);
drop policy if exists custom_cards_owner_update on public.custom_cards;
create policy custom_cards_owner_update on public.custom_cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists custom_cards_owner_delete on public.custom_cards;
create policy custom_cards_owner_delete on public.custom_cards for delete using (auth.uid() = user_id);

create or replace function public.set_custom_cards_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists custom_cards_updated_at on public.custom_cards;
create trigger custom_cards_updated_at before update on public.custom_cards for each row execute function public.set_custom_cards_updated_at();

create or replace function public.prevent_custom_card_identity_change() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id then
    raise exception 'CUSTOM_CARD_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists custom_cards_identity_guard on public.custom_cards;
create trigger custom_cards_identity_guard before update on public.custom_cards
  for each row execute function public.prevent_custom_card_identity_change();

create or replace function public.validate_my_set_custom_cards() returns trigger language plpgsql security definer set search_path = public, auth as $$
declare card_ref text; custom_ref text;
begin
  for card_ref in select value from unnest(new.card_ids) as value order by value loop
    if left(card_ref, 7) = 'custom:' then
      custom_ref := substring(card_ref from 8);
      if custom_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform pg_advisory_xact_lock(hashtextextended('custom-card:' || custom_ref, 0));
      end if;
      if custom_ref <> lower(custom_ref) or custom_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not exists (select 1 from public.custom_cards c where c.id = custom_ref::uuid and c.user_id = new.user_id) then
        raise exception 'CUSTOM_CARD_NOT_OWNED' using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists my_sets_custom_cards_valid on public.my_sets;
create trigger my_sets_custom_cards_valid before insert or update on public.my_sets
  for each row execute function public.validate_my_set_custom_cards();

create or replace function public.prevent_custom_card_delete_if_used() returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('custom-card:' || old.id::text, 0));
  if auth.uid() is not null and exists (
    select 1 from public.my_sets s where s.user_id = old.user_id and ('custom:' || old.id::text) = any(s.card_ids)
  ) then
    raise exception 'CARD_IN_USE' using errcode = '23514';
  end if;
  return old;
end;
$$;
drop trigger if exists custom_cards_delete_guard on public.custom_cards;
create trigger custom_cards_delete_guard before delete on public.custom_cards
  for each row execute function public.prevent_custom_card_delete_if_used();
