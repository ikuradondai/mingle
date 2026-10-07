-- Harden shared and venue snapshots without rewriting or deleting legacy rows.
-- Phase A keeps legacy authenticated writes for cutover compatibility; Phase B
-- closes them.  The API is responsible
-- for resolving standard/custom cards; these functions enforce the resulting
-- shape, byte/card limits, and the derived adult flag atomically.
begin;

create or replace function public.snapshot_cards_valid(p_cards jsonb, p_card_count integer)
returns boolean
language sql immutable security definer
set search_path = public
as $$
  select jsonb_typeof(p_cards) = 'array'
    and p_card_count between 6 and 40
    and jsonb_array_length(p_cards) = p_card_count
    and octet_length(p_cards::text) <= 65536
    and not exists (
      select 1 from jsonb_array_elements(p_cards) card
      where jsonb_typeof(card) <> 'object'
         or not (card ? 'id') or jsonb_typeof(card->'id') <> 'string'
         or char_length(card->>'id') < 1 or char_length(card->>'id') > 120
         or not (card ? 'text') or jsonb_typeof(card->'text') <> 'string'
         or char_length(card->>'text') < 1 or char_length(card->>'text') > 300
         or (card ? 'r18' and jsonb_typeof(card->'r18') <> 'boolean')
    )
    and not exists (
      select 1 from jsonb_array_elements(p_cards) card
      group by card->>'id' having count(*) > 1
    );
$$;

create or replace function public.snapshot_cards_adult(p_cards jsonb)
returns boolean
language sql immutable security definer
set search_path = public
as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) card
                where card->>'r18' = 'true');
$$;

-- Trigger helpers are internal implementation details, not PostgREST APIs.
revoke all on function public.snapshot_cards_valid(jsonb,integer) from public, anon, authenticated;
revoke all on function public.snapshot_cards_adult(jsonb) from public, anon, authenticated;
grant execute on function public.snapshot_cards_valid(jsonb,integer) to service_role;
grant execute on function public.snapshot_cards_adult(jsonb) to service_role;

create or replace function public.shared_sets_snapshot_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.snapshot_cards_valid(new.cards, new.card_count)
     or (not new.adult_only and public.snapshot_cards_adult(new.cards)) then
    raise exception 'INVALID_SHARED_SNAPSHOT' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists shared_sets_snapshot_guard on public.shared_sets;
create trigger shared_sets_snapshot_guard
  before insert or update of cards, card_count, adult_only on public.shared_sets
  for each row execute function public.shared_sets_snapshot_guard();

create or replace function public.venue_sets_snapshot_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.snapshot_cards_valid(new.cards, new.card_count)
     or (not new.adult_only and public.snapshot_cards_adult(new.cards)) then
    raise exception 'INVALID_VENUE_SNAPSHOT' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists venue_sets_snapshot_guard on public.venue_sets;
create trigger venue_sets_snapshot_guard
  before insert or update of cards, card_count, adult_only on public.venue_sets
  for each row execute function public.venue_sets_snapshot_guard();

create or replace function public.shared_sets_owner_cap_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
  select count(*) into n from public.shared_sets where owner_id = new.owner_id;
  if n >= 100 then raise exception 'SHARED_OWNER_LIMIT' using errcode = '54000'; end if;
  return new;
end;
$$;
drop trigger if exists shared_sets_owner_cap on public.shared_sets;
create trigger shared_sets_owner_cap before insert on public.shared_sets
for each row execute function public.shared_sets_owner_cap_guard();

create or replace function public.venue_sets_owner_cap_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer; owner_id uuid;
begin
  select v.owner_id into owner_id from public.venues v where v.id = new.venue_id for update;
  if owner_id is null then raise exception 'VENUE_OWNER_MISMATCH' using errcode = '42501'; end if;
  select count(*) into n from public.venue_sets s where s.venue_id = new.venue_id;
  if n >= 100 then raise exception 'VENUE_SET_LIMIT' using errcode = '54000'; end if;
  return new;
end;
$$;
drop trigger if exists venue_sets_owner_cap on public.venue_sets;
create trigger venue_sets_owner_cap before insert on public.venue_sets
for each row execute function public.venue_sets_owner_cap_guard();

-- Keep owner reads working for the existing API, but remove the table DML path
-- from authenticated users.  service_role is the only writer.
grant select on public.shared_sets, public.venue_sets, public.venue_tables to authenticated;

alter table public.shared_sets add column if not exists token_ciphertext text;
alter table public.shared_sets alter column token drop not null;

drop function if exists public.create_shared_set_server(uuid,uuid,text,text,text,jsonb,text,jsonb,boolean);
create or replace function public.create_shared_set_server(
  p_owner_id uuid, p_set_id uuid, p_token text, p_token_hash text,
  p_token_ciphertext text, p_name text, p_cards jsonb, p_adult_only boolean default false, p_question_order text default 'shuffle',
  p_design jsonb default null, p_rotate boolean default false
) returns table(id uuid, token text, name text, card_count integer, adult_only boolean)
language plpgsql security definer set search_path = public, auth as $$
declare source_owner uuid; existing public.shared_sets%rowtype; n integer;
begin
  if p_owner_id is null or p_set_id is null or p_token !~ '^[A-Za-z0-9_-]{43}$'
     or p_token_hash !~ '^[0-9a-f]{64}$' or p_token_ciphertext is null
     or char_length(p_token_ciphertext) > 4096 or p_question_order not in ('shuffle','fixed')
     or p_name is null or char_length(btrim(p_name)) not between 1 and 80
     or not public.snapshot_cards_valid(p_cards, coalesce(jsonb_array_length(p_cards), 0)) then
    raise exception 'INVALID_SHARED_REQUEST' using errcode = '22023';
  end if;
  select s.user_id into source_owner from public.my_sets s where s.id = p_set_id for update;
  if source_owner is distinct from p_owner_id then raise exception 'SHARED_OWNER_MISMATCH' using errcode = '42501'; end if;
  if not p_rotate then
    select * into existing from public.shared_sets where set_id = p_set_id and revoked_at is null for update;
    if found then return query select existing.id, existing.token, existing.name, existing.card_count, existing.adult_only; return; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));
  select count(*) into n from public.shared_sets where owner_id = p_owner_id;
  if n >= 100 then raise exception 'SHARED_OWNER_LIMIT' using errcode = '54000'; end if;
  update public.shared_sets set revoked_at = now() where set_id = p_set_id and revoked_at is null;
  return query insert into public.shared_sets(owner_id,set_id,token,token_hash,token_ciphertext,name,card_count,adult_only,cards,question_order,design)
    values (p_owner_id,p_set_id,null,p_token_hash,p_token_ciphertext,btrim(p_name),jsonb_array_length(p_cards),coalesce(p_adult_only,false) or public.snapshot_cards_adult(p_cards),p_cards,p_question_order,p_design)
    returning shared_sets.id,p_token,shared_sets.name,shared_sets.card_count,shared_sets.adult_only;
end;
$$;

create or replace function public.revoke_shared_set_server(p_owner_id uuid, p_set_id uuid)
returns boolean language plpgsql security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from public.my_sets where id=p_set_id and user_id=p_owner_id) then raise exception 'SHARED_OWNER_MISMATCH' using errcode='42501'; end if;
  update public.shared_sets set revoked_at=now() where set_id=p_set_id and owner_id=p_owner_id and revoked_at is null;
  return true;
end;
$$;

create or replace function public.create_venue_set_server(
  p_owner_id uuid, p_venue_id uuid, p_name text, p_cards jsonb, p_adult_only boolean default false, p_design jsonb default null
) returns table(id uuid, venue_id uuid, name text, cards jsonb, card_count integer, adult_only boolean, active boolean, design jsonb)
language plpgsql security definer set search_path = public, auth as $$
declare n integer; adult boolean;
begin
  if p_owner_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 80
     or not public.snapshot_cards_valid(p_cards, coalesce(jsonb_array_length(p_cards),0)) then raise exception 'INVALID_VENUE_REQUEST' using errcode='22023'; end if;
  perform 1 from public.venues v where v.id=p_venue_id and v.owner_id=p_owner_id for update;
  if not found then raise exception 'VENUE_OWNER_MISMATCH' using errcode='42501'; end if;
  adult := coalesce(p_adult_only,false) or public.snapshot_cards_adult(p_cards);
  if adult and not exists (select 1 from public.venues v where v.id=p_venue_id and v.adult_enabled) then raise exception 'ADULT_VENUE_REQUIRED' using errcode='22023'; end if;
  select count(*) into n from public.venue_sets s where s.venue_id=p_venue_id;
  if n >= 100 then raise exception 'VENUE_SET_LIMIT' using errcode='54000'; end if;
  return query insert into public.venue_sets(venue_id,name,cards,card_count,adult_only,design)
    values(p_venue_id,btrim(p_name),p_cards,jsonb_array_length(p_cards),adult,p_design)
    returning venue_sets.id,venue_sets.venue_id,venue_sets.name,venue_sets.cards,venue_sets.card_count,venue_sets.adult_only,venue_sets.active,venue_sets.design;
end;
$$;

create or replace function public.set_venue_set_active_server(p_owner_id uuid, p_set_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path = public, auth as $$
begin
  update public.venue_sets s set active=p_active
   where s.id=p_set_id and exists (select 1 from public.venues v where v.id=s.venue_id and v.owner_id=p_owner_id);
  if not found then raise exception 'VENUE_SET_NOT_FOUND' using errcode='42501'; end if;
  return true;
end;
$$;

grant execute on function public.create_shared_set_server(uuid,uuid,text,text,text,text,jsonb,boolean,text,jsonb,boolean) to service_role;
grant execute on function public.revoke_shared_set_server(uuid,uuid) to service_role;
grant execute on function public.create_venue_set_server(uuid,uuid,text,jsonb,boolean,jsonb) to service_role;
grant execute on function public.set_venue_set_active_server(uuid,uuid,boolean) to service_role;
revoke all on function public.create_shared_set_server(uuid,uuid,text,text,text,text,jsonb,boolean,text,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.revoke_shared_set_server(uuid,uuid) from public, anon, authenticated;
revoke all on function public.create_venue_set_server(uuid,uuid,text,jsonb,boolean,jsonb) from public, anon, authenticated;
revoke all on function public.set_venue_set_active_server(uuid,uuid,boolean) from public, anon, authenticated;

commit;
