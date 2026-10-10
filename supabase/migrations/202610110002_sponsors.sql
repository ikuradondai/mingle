create table if not exists public.sponsor_sets (
  id uuid primary key,
  provider_name text not null check (char_length(btrim(provider_name)) between 1 and 80),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  categories text[] not null check (cardinality(categories) between 1 and 12 and categories <@ array['self','relationship','friends','family','work','sports','first-meeting','roleplay','adult','game','love','school']::text[]),
  audience text not null check (audience in ('group','solo','both')),
  cards jsonb not null check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) between 6 and 40),
  card_count integer generated always as (jsonb_array_length(cards)) stored,
  status text not null default 'draft' check (status in ('draft','published')),
  end_message text not null default '' check (char_length(end_message) <= 500),
  site_url text check (site_url is null or (site_url ~ '^https://[^[:space:]]+$' and site_url !~ '^https://[^/]*:[^/]*@')),
  cta_label text not null default '' check (char_length(cta_label) <= 40),
  is_r18 boolean not null default false check (not ('adult' = any(categories)) or is_r18),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sponsor_sets_public_idx on public.sponsor_sets(status, updated_at desc);
alter table public.sponsor_sets enable row level security;
revoke all on public.sponsor_sets from public, anon, authenticated;
grant all on public.sponsor_sets to service_role;
