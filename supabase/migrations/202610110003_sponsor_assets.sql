alter table public.sponsor_sets
  add column if not exists design jsonb,
  add column if not exists thumbnail_path text,
  add column if not exists card_front_path text,
  add column if not exists card_back_path text;

alter table public.sponsor_sets
  drop constraint if exists sponsor_sets_asset_path_check;
alter table public.sponsor_sets
  add constraint sponsor_sets_asset_path_check check (
    (thumbnail_path is null or thumbnail_path ~ '^sponsor-assets/[0-9a-f-]{36}\.(png|jpg|webp)$') and
    (card_front_path is null or card_front_path ~ '^sponsor-assets/[0-9a-f-]{36}\.(png|jpg|webp)$') and
    (card_back_path is null or card_back_path ~ '^sponsor-assets/[0-9a-f-]{36}\.(png|jpg|webp)$')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-assets', 'sponsor-assets', true, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sponsor_assets_public_read on storage.objects;
create policy sponsor_assets_public_read on storage.objects
  for select using (bucket_id = 'sponsor-assets');

drop policy if exists sponsor_assets_service_write on storage.objects;
create policy sponsor_assets_service_write on storage.objects
  for all to service_role using (bucket_id = 'sponsor-assets') with check (bucket_id = 'sponsor-assets');
