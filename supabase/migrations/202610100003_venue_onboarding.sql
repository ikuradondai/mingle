-- Optional owner-managed profile fields for the venue onboarding flow.
-- Existing owner_id RLS policies continue to protect these columns.
begin;
alter table public.venues add column if not exists industry text;
alter table public.venues add column if not exists address text;
alter table public.venues drop constraint if exists venues_industry_length;
alter table public.venues add constraint venues_industry_length check (industry is null or char_length(industry) <= 80);
alter table public.venues drop constraint if exists venues_address_length;
alter table public.venues add constraint venues_address_length check (address is null or char_length(address) <= 240);
commit;
