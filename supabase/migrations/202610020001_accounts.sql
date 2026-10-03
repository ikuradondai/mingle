create or replace function public.unique_card_ids(card_values text[]) returns boolean language sql immutable as $$
  select cardinality(card_values) = (select count(distinct value) from unnest(card_values) as value);
$$;

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create table if not exists public.my_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  card_ids text[] not null default '{}' check (cardinality(card_ids) between 6 and 40 and public.unique_card_ids(card_ids)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists favorites_user_created_idx on public.favorites(user_id, created_at desc);
create index if not exists my_sets_user_created_idx on public.my_sets(user_id, created_at);

alter table public.favorites enable row level security;
alter table public.my_sets enable row level security;

drop policy if exists favorites_owner_select on public.favorites;
create policy favorites_owner_select on public.favorites for select using (auth.uid() = user_id);
drop policy if exists favorites_owner_insert on public.favorites;
create policy favorites_owner_insert on public.favorites for insert with check (auth.uid() = user_id);
drop policy if exists favorites_owner_delete on public.favorites;
create policy favorites_owner_delete on public.favorites for delete using (auth.uid() = user_id);

drop policy if exists my_sets_owner_select on public.my_sets;
create policy my_sets_owner_select on public.my_sets for select using (auth.uid() = user_id);
drop policy if exists my_sets_owner_insert on public.my_sets;
create policy my_sets_owner_insert on public.my_sets for insert with check (auth.uid() = user_id);
drop policy if exists my_sets_owner_update on public.my_sets;
create policy my_sets_owner_update on public.my_sets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists my_sets_owner_delete on public.my_sets;
create policy my_sets_owner_delete on public.my_sets for delete using (auth.uid() = user_id);

create or replace function public.set_my_sets_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists my_sets_updated_at on public.my_sets;
create trigger my_sets_updated_at before update on public.my_sets for each row execute function public.set_my_sets_updated_at();
