-- Private profile avatar storage. Run after the account tables migration.
-- The bucket is intentionally private; Storage API operations remain subject to storage.objects RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 262144, array['image/jpeg'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = 262144,
  allowed_mime_types = array['image/jpeg'];

drop policy if exists profile_avatars_owner_select on storage.objects;
drop policy if exists profile_avatars_owner_insert on storage.objects;
drop policy if exists profile_avatars_owner_update on storage.objects;
drop policy if exists profile_avatars_owner_delete on storage.objects;

create policy profile_avatars_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-avatars' and name = (select auth.uid()::text) || '/avatar.jpg');

create policy profile_avatars_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-avatars' and name = (select auth.uid()::text) || '/avatar.jpg');

create policy profile_avatars_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-avatars' and name = (select auth.uid()::text) || '/avatar.jpg')
  with check (bucket_id = 'profile-avatars' and name = (select auth.uid()::text) || '/avatar.jpg');

create policy profile_avatars_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-avatars' and name = (select auth.uid()::text) || '/avatar.jpg');
