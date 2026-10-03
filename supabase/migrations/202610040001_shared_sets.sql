create table if not exists public.shared_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  set_id uuid not null references public.my_sets(id) on delete cascade,
  token text not null unique,
  token_hash text not null unique,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  card_count integer not null check (card_count between 6 and 40),
  adult_only boolean not null default false,
  cards jsonb not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists shared_sets_owner_set_idx on public.shared_sets(owner_id, set_id);
create index if not exists shared_sets_active_token_idx on public.shared_sets(token_hash) where revoked_at is null;
create unique index if not exists shared_sets_one_active_per_set_idx on public.shared_sets(set_id) where revoked_at is null;

alter table public.shared_sets enable row level security;
drop policy if exists shared_sets_public_read on public.shared_sets;
drop policy if exists shared_sets_owner_select on public.shared_sets;
create policy shared_sets_owner_select on public.shared_sets for select to authenticated using (auth.uid() = owner_id);
drop policy if exists shared_sets_owner_insert on public.shared_sets;
create policy shared_sets_owner_insert on public.shared_sets for insert to authenticated with check (auth.uid() = owner_id and exists (select 1 from public.my_sets s where s.id = set_id and s.user_id = auth.uid()));
drop policy if exists shared_sets_owner_update on public.shared_sets;
create policy shared_sets_owner_update on public.shared_sets for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id and exists (select 1 from public.my_sets s where s.id = set_id and s.user_id = auth.uid()));
drop policy if exists shared_sets_owner_delete on public.shared_sets;
create policy shared_sets_owner_delete on public.shared_sets for delete to authenticated using (auth.uid() = owner_id);
revoke all on public.shared_sets from anon;
grant select, insert, update, delete on public.shared_sets to authenticated;

create or replace function public.create_shared_set(
  p_set_id uuid, p_token text, p_token_hash text, p_name text,
  p_card_count integer, p_adult_only boolean, p_cards jsonb, p_rotate boolean default false
) returns table(id uuid, token text, name text, card_count integer, adult_only boolean)
language plpgsql security invoker set search_path = public, auth as $$
declare set_owner uuid; existing public.shared_sets%rowtype; source_ids text[];
begin
  select s.user_id into set_owner from public.my_sets s where s.id = p_set_id for update;
  if set_owner is null or set_owner <> auth.uid() then raise exception 'shared set owner mismatch' using errcode = '42501'; end if;
  select s.card_ids into source_ids from public.my_sets s where s.id = p_set_id;
  if p_card_count <> cardinality(source_ids) or jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) <> cardinality(source_ids) or
     (select array_agg(item->>'id' order by ordinality) from jsonb_array_elements(p_cards) with ordinality as x(item, ordinality)) <> source_ids then
    raise exception 'shared snapshot does not match set' using errcode = '22023';
  end if;
  if not p_rotate then
    select ss.* into existing from public.shared_sets ss where ss.set_id = p_set_id and ss.revoked_at is null limit 1;
    if found then return query select existing.id, existing.token, existing.name, existing.card_count, existing.adult_only; return; end if;
  end if;
  update public.shared_sets ss set revoked_at = now() where ss.set_id = p_set_id and ss.revoked_at is null;
  return query insert into public.shared_sets(owner_id, set_id, token, token_hash, name, card_count, adult_only, cards)
    values (auth.uid(), p_set_id, p_token, p_token_hash, btrim(p_name), p_card_count, p_adult_only, p_cards)
    returning shared_sets.id, shared_sets.token, shared_sets.name, shared_sets.card_count, shared_sets.adult_only;
end;
$$;

create or replace function public.revoke_shared_set(p_set_id uuid) returns boolean
language plpgsql security invoker set search_path = public, auth as $$
declare set_owner uuid;
begin
  select s.user_id into set_owner from public.my_sets s where s.id = p_set_id for update;
  if set_owner is null or set_owner <> auth.uid() then raise exception 'shared set owner mismatch' using errcode = '42501'; end if;
  update public.shared_sets ss set revoked_at = now() where ss.set_id = p_set_id and ss.revoked_at is null;
  return true;
end;
$$;

grant execute on function public.create_shared_set(uuid, text, text, text, integer, boolean, jsonb, boolean) to authenticated;
grant execute on function public.revoke_shared_set(uuid) to authenticated;
