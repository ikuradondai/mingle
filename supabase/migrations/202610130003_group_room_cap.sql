-- Atomic cap for active, non-expired group rooms per owner.  The trigger
-- covers service-role REST inserts as well as group_create_room RPC calls.
begin;
create or replace function public.group_room_active_owner_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare active_count integer;
begin
  if new.expires_at <= now() or new.status = 'ended' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.host_user_id::text, 0));
  select count(*) into active_count from public.group_rooms
   where host_user_id = new.host_user_id and expires_at > now() and status <> 'ended';
  if active_count >= 20 then raise exception 'GROUP_OWNER_LIMIT' using errcode = '54000'; end if;
  return new;
end;
$$;
drop trigger if exists group_rooms_active_owner_cap on public.group_rooms;
create trigger group_rooms_active_owner_cap before insert on public.group_rooms
for each row execute function public.group_room_active_owner_cap();
commit;
