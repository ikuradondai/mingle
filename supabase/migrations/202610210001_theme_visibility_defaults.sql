-- Preserve existing theme visibility choices and mark new profiles for default R18 hiding.
begin;

alter table public.account_profiles
  add column if not exists theme_visibility_initialized boolean not null default true;

-- Existing rows receive true on the first add, while future profile rows remain
-- uninitialized. Re-running this migration must preserve both states.
alter table public.account_profiles
  alter column theme_visibility_initialized set default false;

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
  insert into public.account_profiles(user_id, hidden_theme_ids, theme_visibility_initialized)
  values (v_user, v_ids, true)
  on conflict (user_id) do update set hidden_theme_ids = excluded.hidden_theme_ids, theme_visibility_initialized = true, updated_at = now();
  return v_ids;
end; $$;
revoke all on function public.set_theme_visibility(text[]) from public, anon;
grant execute on function public.set_theme_visibility(text[]) to authenticated;

commit;
