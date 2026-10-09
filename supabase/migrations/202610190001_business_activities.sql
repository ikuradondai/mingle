begin;

alter table public.organization_policies
  add column if not exists business_activities_enabled boolean not null default true,
  add column if not exists custom_quiz_enabled boolean not null default true,
  add column if not exists general_quiz_enabled boolean not null default true;

create table if not exists public.organization_quizzes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists organization_quizzes_org_idx on public.organization_quizzes(organization_id,status,updated_at desc);

create table if not exists public.organization_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.organization_quizzes(id) on delete cascade,
  position integer not null check (position >= 0 and position < 100),
  question text not null check (char_length(btrim(question)) between 1 and 1000),
  answer text not null check (char_length(btrim(answer)) between 1 and 1000),
  explanation text not null default '' check (char_length(explanation) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id,position)
);
create index if not exists organization_quiz_questions_quiz_idx on public.organization_quiz_questions(quiz_id,position);

alter table public.organization_quizzes enable row level security;
alter table public.organization_quiz_questions enable row level security;
revoke all on public.organization_quizzes, public.organization_quiz_questions from anon, authenticated;
grant all on public.organization_quizzes, public.organization_quiz_questions to service_role;

create or replace function public.org_content_policy(p_actor uuid,p_org uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor organization_members; p organization_policies;
begin
 actor:=org_member(p_org,p_actor);
 if actor.id is null then raise exception 'ORG_FORBIDDEN'; end if;
 select * into p from organization_policies where organization_id=p_org;
 return jsonb_build_object(
   'businessActivities',coalesce(p.business_activities_enabled,true),
   'customQuiz',coalesce(p.custom_quiz_enabled,true),
   'generalQuiz',coalesce(p.general_quiz_enabled,true)
 );
end;
$$;

create or replace function public.org_set_content_policy(p_actor uuid,p_org uuid,p_business boolean,p_custom boolean,p_general boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor organization_members; outrow organization_policies;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 actor:=org_member(p_org,p_actor);
 if actor.id is null or actor.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN'; end if;
 if p_business is null or p_custom is null or p_general is null then raise exception 'POLICY_INVALID'; end if;
 update organization_policies set business_activities_enabled=p_business,custom_quiz_enabled=p_custom,general_quiz_enabled=p_general,updated_by=p_actor,updated_at=now() where organization_id=p_org returning * into outrow;
 if outrow.organization_id is null then raise exception 'ORG_NOT_FOUND'; end if;
 return jsonb_build_object('businessActivities',outrow.business_activities_enabled,'customQuiz',outrow.custom_quiz_enabled,'generalQuiz',outrow.general_quiz_enabled);
end;
$$;

create or replace function public.org_set_all_policy(p_actor uuid,p_org uuid,p_themes jsonb,p_flags jsonb,p_business boolean,p_custom boolean,p_general boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare feature jsonb; content jsonb;
begin
 feature := public.org_set_policy(p_actor,p_org,p_themes,p_flags);
 content := public.org_set_content_policy(p_actor,p_org,p_business,p_custom,p_general);
 return jsonb_build_object('featurePolicy',feature,'contentFlags',content);
end;
$$;

create or replace function public.org_quiz_list(p_actor uuid,p_org uuid,p_include_drafts boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor organization_members; result jsonb; policy organization_policies;
begin
 actor:=org_member(p_org,p_actor);
 if actor.id is null then raise exception 'ORG_FORBIDDEN'; end if;
 select * into policy from organization_policies where organization_id=p_org;
 if coalesce(policy.custom_quiz_enabled,true) is false then raise exception 'FEATURE_DISABLED'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',q.id,'title',q.title,'description',q.description,'status',q.status,'createdAt',q.created_at,'updatedAt',q.updated_at,
   'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'position',x.position,'question',x.question,'answer',x.answer,'explanation',x.explanation) order by x.position),'[]'::jsonb) from organization_quiz_questions x where x.quiz_id=q.id)
 ) order by q.updated_at desc),'[]'::jsonb) into result
 from organization_quizzes q where q.organization_id=p_org and (q.status='published' or (p_include_drafts and actor.role in ('owner','admin')));
 return result;
end;
$$;

create or replace function public.org_quiz_create(p_actor uuid,p_org uuid,p_title text,p_description text,p_questions jsonb,p_status text default 'draft')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor organization_members; q organization_quizzes; item jsonb; idx integer:=0; quiz_count integer; policy organization_policies;
begin
 actor:=org_member(p_org,p_actor);
 if actor.id is null or actor.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN'; end if;
 select * into policy from organization_policies where organization_id=p_org;
 if coalesce(policy.custom_quiz_enabled,true) is false then raise exception 'FEATURE_DISABLED'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 120 or p_description is null or char_length(p_description)>500 or p_status is null or p_status not in ('draft','published') or p_questions is null or jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions)<1 or jsonb_array_length(p_questions)>100 or pg_column_size(p_questions)+char_length(p_title)+char_length(p_description)>262144 then raise exception 'QUIZ_INVALID'; end if;
 select count(*) into quiz_count from organization_quizzes where organization_id=p_org;
 if quiz_count >= 100 then raise exception 'QUIZ_LIMIT'; end if;
 insert into organization_quizzes(organization_id,title,description,status,created_by,updated_by) values(p_org,btrim(p_title),p_description,p_status,p_actor,p_actor) returning * into q;
 for item in select * from jsonb_array_elements(p_questions) loop
   if jsonb_typeof(item)<>'object' or not (item ? 'question') or not (item ? 'answer') or jsonb_typeof(item->'question')<>'string' or jsonb_typeof(item->'answer')<>'string' or (item ? 'explanation' and jsonb_typeof(item->'explanation')<>'string') or char_length(btrim(item->>'question')) not between 1 and 1000 or char_length(btrim(item->>'answer')) not between 1 and 1000 or char_length(coalesce(item->>'explanation',''))>2000 then raise exception 'QUIZ_INVALID'; end if;
   insert into organization_quiz_questions(quiz_id,position,question,answer,explanation) values(q.id,idx,btrim(item->>'question'),btrim(item->>'answer'),coalesce(item->>'explanation',''));
   idx:=idx+1;
 end loop;
 return (select x from jsonb_array_elements(public.org_quiz_list(p_actor,p_org,true)) x where x->>'id'=q.id::text limit 1);
end;
$$;

create or replace function public.org_quiz_update(p_actor uuid,p_org uuid,p_quiz uuid,p_title text,p_description text,p_questions jsonb,p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor organization_members; q organization_quizzes; item jsonb; idx integer:=0; policy organization_policies;
begin
 actor:=org_member(p_org,p_actor);
 if actor.id is null or actor.role not in ('owner','admin') then raise exception 'ORG_FORBIDDEN'; end if;
 select * into policy from organization_policies where organization_id=p_org;
 if coalesce(policy.custom_quiz_enabled,true) is false then raise exception 'FEATURE_DISABLED'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 120 or p_description is null or char_length(p_description)>500 or p_status is null or p_status not in ('draft','published') or p_questions is null or jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions)<1 or jsonb_array_length(p_questions)>100 or pg_column_size(p_questions)+char_length(p_title)+char_length(p_description)>262144 then raise exception 'QUIZ_INVALID'; end if;
 select * into q from organization_quizzes where id=p_quiz and organization_id=p_org for update;
 if q.id is null then raise exception 'QUIZ_NOT_FOUND'; end if;
 update organization_quizzes set title=btrim(p_title),description=p_description,status=p_status,updated_by=p_actor,updated_at=now() where id=q.id;
 delete from organization_quiz_questions where quiz_id=q.id;
 for item in select * from jsonb_array_elements(p_questions) loop
   if jsonb_typeof(item)<>'object' or not (item ? 'question') or not (item ? 'answer') or jsonb_typeof(item->'question')<>'string' or jsonb_typeof(item->'answer')<>'string' or (item ? 'explanation' and jsonb_typeof(item->'explanation')<>'string') or char_length(btrim(item->>'question')) not between 1 and 1000 or char_length(btrim(item->>'answer')) not between 1 and 1000 or char_length(coalesce(item->>'explanation',''))>2000 then raise exception 'QUIZ_INVALID'; end if;
   insert into organization_quiz_questions(quiz_id,position,question,answer,explanation) values(q.id,idx,btrim(item->>'question'),btrim(item->>'answer'),coalesce(item->>'explanation',''));
   idx:=idx+1;
 end loop;
 return (select x from jsonb_array_elements(public.org_quiz_list(p_actor,p_org,true)) x where x->>'id'=q.id::text limit 1);
end;
$$;

revoke all on function public.org_content_policy(uuid,uuid),public.org_set_content_policy(uuid,uuid,boolean,boolean,boolean),public.org_set_all_policy(uuid,uuid,jsonb,jsonb,boolean,boolean,boolean),public.org_quiz_list(uuid,uuid,boolean),public.org_quiz_create(uuid,uuid,text,text,jsonb,text),public.org_quiz_update(uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.org_content_policy(uuid,uuid),public.org_set_content_policy(uuid,uuid,boolean,boolean,boolean),public.org_set_all_policy(uuid,uuid,jsonb,jsonb,boolean,boolean,boolean),public.org_quiz_list(uuid,uuid,boolean),public.org_quiz_create(uuid,uuid,text,text,jsonb,text),public.org_quiz_update(uuid,uuid,uuid,text,text,jsonb,text) to service_role;
commit;
