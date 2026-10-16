-- Per-account theme visibility preferences. A checked theme is hidden.
begin;

alter table public.account_profiles
  add column if not exists hidden_theme_ids jsonb not null default '[]'::jsonb;

alter table public.account_profiles
  drop constraint if exists account_profiles_hidden_theme_ids_array;
alter table public.account_profiles
  add constraint account_profiles_hidden_theme_ids_array
  check (jsonb_typeof(hidden_theme_ids) = 'array');

create or replace function public.set_theme_visibility(p_hidden_theme_ids text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_ids jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if p_hidden_theme_ids is null
    or exists (select 1 from unnest(p_hidden_theme_ids) id where id is null or btrim(id) = '' or char_length(id) > 100 or id !~ '^[a-z0-9][a-z0-9-]*$')
    or cardinality(p_hidden_theme_ids) > 200
    or cardinality(p_hidden_theme_ids) <> (select count(distinct id) from unnest(p_hidden_theme_ids) id)
  then raise exception 'INVALID_REQUEST' using errcode = '22023'; end if;
  v_ids := to_jsonb(p_hidden_theme_ids);
  insert into public.account_profiles(user_id, hidden_theme_ids)
  values (v_user, v_ids)
  on conflict (user_id) do update set hidden_theme_ids = excluded.hidden_theme_ids, updated_at = now();
  return v_ids;
end; $$;
revoke all on function public.set_theme_visibility(text[]) from public, anon;
grant execute on function public.set_theme_visibility(text[]) to authenticated;

commit;
