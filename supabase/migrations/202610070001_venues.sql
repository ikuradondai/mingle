begin;
grant usage on schema public to authenticated, service_role;
-- Venue MVP: owner-scoped venue settings, immutable playable set snapshots,
-- revocable table QR tokens, and aggregate-only usage events.
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  logo_url text,
  store_url text,
  ending_url text,
  welcome_text text not null default '' check (char_length(welcome_text) <= 240),
  adult_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists venues_owner_idx on public.venues(owner_id, created_at);
alter table public.venues enable row level security;
drop policy if exists venues_owner_select on public.venues;
drop policy if exists venues_owner_insert on public.venues;
drop policy if exists venues_owner_update on public.venues;
drop policy if exists venues_owner_delete on public.venues;
create policy venues_owner_select on public.venues for select using (auth.uid() = owner_id);
create policy venues_owner_insert on public.venues for insert with check (auth.uid() = owner_id);
create policy venues_owner_update on public.venues for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy venues_owner_delete on public.venues for delete using (auth.uid() = owner_id);

create table if not exists public.venue_sets (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  cards jsonb not null check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) between 6 and 40),
  card_count integer not null check (card_count between 6 and 40 and jsonb_array_length(cards) = card_count),
  check (adult_only or not (cards @? '$[*] ? (@.r18 == true)')),
  adult_only boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists venue_sets_tenant_id_idx on public.venue_sets(venue_id, id);
create index if not exists venue_sets_venue_idx on public.venue_sets(venue_id, active, created_at);
alter table public.venue_sets enable row level security;
drop policy if exists venue_sets_owner_select on public.venue_sets;
drop policy if exists venue_sets_owner_insert on public.venue_sets;
drop policy if exists venue_sets_owner_update on public.venue_sets;
drop policy if exists venue_sets_owner_delete on public.venue_sets;
create policy venue_sets_owner_select on public.venue_sets for select using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));
create policy venue_sets_owner_insert on public.venue_sets for insert with check (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));
create policy venue_sets_owner_update on public.venue_sets for update using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())) with check (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));
create policy venue_sets_owner_delete on public.venue_sets for delete using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));

create table if not exists public.venue_tables (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  token_hash text not null unique,
  token_ciphertext text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists venue_tables_tenant_id_idx on public.venue_tables(venue_id, id);
create index if not exists venue_tables_venue_idx on public.venue_tables(venue_id, active, created_at);
alter table public.venue_tables enable row level security;
drop policy if exists venue_tables_owner_select on public.venue_tables;
drop policy if exists venue_tables_owner_insert on public.venue_tables;
drop policy if exists venue_tables_owner_update on public.venue_tables;
drop policy if exists venue_tables_owner_delete on public.venue_tables;
create policy venue_tables_owner_select on public.venue_tables for select using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));
create policy venue_tables_owner_insert on public.venue_tables for insert with check (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));
create policy venue_tables_owner_update on public.venue_tables for update using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid())) with check (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));
create policy venue_tables_owner_delete on public.venue_tables for delete using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));

create table if not exists public.venue_usage_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  venue_set_id uuid not null,
  table_id uuid not null,
  session_hash text not null,
  event_type text not null check (event_type in ('started', 'completed_round')),
  round_index integer not null default 1 check (round_index between 1 and 40),
  created_at timestamptz not null default now(),
  unique(table_id, session_hash, event_type, round_index)
);
alter table public.venue_usage_events drop constraint if exists venue_usage_events_tenant_set_fk;
alter table public.venue_usage_events drop constraint if exists venue_usage_events_tenant_table_fk;
alter table public.venue_usage_events add constraint venue_usage_events_tenant_set_fk foreign key (venue_id, venue_set_id) references public.venue_sets(venue_id, id) on delete cascade;
alter table public.venue_usage_events add constraint venue_usage_events_tenant_table_fk foreign key (venue_id, table_id) references public.venue_tables(venue_id, id) on delete cascade;
create index if not exists venue_usage_venue_idx on public.venue_usage_events(venue_id, created_at);
alter table public.venue_usage_events enable row level security;
drop policy if exists venue_usage_owner_select on public.venue_usage_events;
create policy venue_usage_owner_select on public.venue_usage_events for select using (exists (select 1 from public.venues v where v.id = venue_id and v.owner_id = auth.uid()));
revoke all on public.venue_usage_events from anon, authenticated;
grant select on public.venue_usage_events to authenticated;
revoke all on public.venues, public.venue_sets, public.venue_tables from anon, authenticated;
grant select, insert, update, delete on public.venues, public.venue_sets, public.venue_tables to authenticated;
grant select on public.venues, public.venue_sets, public.venue_tables, public.venue_usage_events to service_role;
grant insert on public.venue_usage_events to service_role;

create or replace function public.set_venues_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists venues_updated_at on public.venues;
create trigger venues_updated_at before update on public.venues for each row execute function public.set_venues_updated_at();
commit;
