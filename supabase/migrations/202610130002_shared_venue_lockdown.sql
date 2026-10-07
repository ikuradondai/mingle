-- Phase B: deploy only after the application is using the phase-A RPCs.
-- This closes the legacy table/RPC write paths atomically.
begin;
revoke insert, update, delete on public.shared_sets, public.venue_sets from public, anon, authenticated;
do $$ declare fn record; begin
  for fn in select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_shared_set','revoke_shared_set')
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated', fn.nspname, fn.proname, fn.args);
  end loop;
end $$;
revoke all on function public.create_shared_set_server(uuid,uuid,text,text,text,text,jsonb,boolean,text,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.revoke_shared_set_server(uuid,uuid) from public, anon, authenticated;
revoke all on function public.create_venue_set_server(uuid,uuid,text,jsonb,boolean,jsonb) from public, anon, authenticated;
revoke all on function public.set_venue_set_active_server(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.create_shared_set_server(uuid,uuid,text,text,text,text,jsonb,boolean,text,jsonb,boolean) to service_role;
grant execute on function public.revoke_shared_set_server(uuid,uuid) to service_role;
grant execute on function public.create_venue_set_server(uuid,uuid,text,jsonb,boolean,jsonb) to service_role;
grant execute on function public.set_venue_set_active_server(uuid,uuid,boolean) to service_role;
commit;
