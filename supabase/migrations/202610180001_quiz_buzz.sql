begin;

alter table public.group_rooms drop constraint if exists group_rooms_game_type;
alter table public.group_rooms add constraint group_rooms_game_type
  check (game_type in ('cards','minority_topic','question_wolf','ochi_kara','one_cut','mission_mingle','quiz_buzz')) not valid;
alter table public.group_rooms validate constraint group_rooms_game_type;

create table if not exists public.quiz_buzz_games (
  room_id uuid primary key references public.group_rooms(id) on delete cascade,
  difficulty text not null check (difficulty in ('beginner','intermediate','advanced','expert')),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) = 6),
  phase text not null default 'lobby' check (phase in ('lobby','playing','complete')),
  round_no integer not null default 0 check (round_no between 0 and 6),
  question_index integer not null default 0 check (question_index between 0 and 6),
  total_questions integer not null default 6 check (total_questions = 6),
  scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_buzz_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_buzz_games(room_id) on delete cascade,
  round_no integer not null check (round_no between 1 and 6),
  question_id text not null,
  question_text text not null,
  choices jsonb not null check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) = 4),
  correct_choice_id text not null,
  explanation text not null,
  phase text not null default 'buzz' check (phase in ('buzz','answer','reveal','complete')),
  opened_at timestamptz not null default now(),
  answer_due_at timestamptz not null,
  overall_due_at timestamptz not null,
  reveal_due_at timestamptz,
  winner_member_id uuid references public.group_members(id),
  winner_claim_id uuid,
  winner_choice_id text,
  winner_answered_at timestamptz,
  locked_member_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(locked_member_ids) = 'array'),
  unique(room_id, round_no)
);

create table if not exists public.quiz_buzz_attempts (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.quiz_buzz_rounds(id) on delete cascade,
  member_id uuid not null references public.group_members(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  answered_at timestamptz,
  choice_id text,
  result text not null default 'claimed' check (result in ('claimed','correct','wrong','timeout')),
  unique(round_id, member_id)
);
create index if not exists quiz_buzz_rounds_room_idx on public.quiz_buzz_rounds(room_id, round_no);
create index if not exists quiz_buzz_attempts_round_idx on public.quiz_buzz_attempts(round_id);
alter table public.quiz_buzz_games enable row level security;
alter table public.quiz_buzz_rounds enable row level security;
alter table public.quiz_buzz_attempts enable row level security;
revoke all on public.quiz_buzz_games, public.quiz_buzz_rounds, public.quiz_buzz_attempts from anon, authenticated;
grant all on public.quiz_buzz_games, public.quiz_buzz_rounds, public.quiz_buzz_attempts to service_role;

create or replace function public.quiz_buzz_create_room(
  p_host_user_id uuid, p_invite_hash text, p_host_secret_hash text, p_host_name text,
  p_expires_at timestamptz, p_difficulty text, p_questions jsonb
) returns table(room_id uuid, host_member_id uuid)
language plpgsql security definer set search_path=public as $$
declare r uuid; m uuid; cards jsonb;
begin
  if p_difficulty not in ('beginner','intermediate','advanced','expert')
    or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) <> 6 then raise exception 'QUIZ_BUZZ_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q->'choices') <> 'array' or jsonb_array_length(q->'choices') <> 4 or nullif(q->>'id','') is null or nullif(q->>'question','') is null or nullif(q->>'correctChoiceId','') is null or not exists (select 1 from jsonb_array_elements(q->'choices') c where c->>'id'=q->>'correctChoiceId')) then raise exception 'QUIZ_BUZZ_INVALID'; end if;
  cards := (select jsonb_agg(jsonb_build_object('id','quiz-buzz:'||((ord-1)::text),'text','クイズ','r18',false,'sourceDeckId','quiz_buzz','participantRule','group') order by ord) from generate_series(1,6) ord);
  insert into public.group_rooms(host_user_id,invite_hash,deck_id,deck_name,cards,adult_only,member_count,expires_at,game_type)
    values(p_host_user_id,p_invite_hash,'quiz_buzz','みんなで早押しクイズ',cards,false,1,p_expires_at,'quiz_buzz') returning id into r;
  insert into public.group_members(room_id,secret_hash,display_name,role,adult_confirmed) values(r,p_host_secret_hash,left(p_host_name,40),'host',true) returning id into m;
  insert into public.quiz_buzz_games(room_id,difficulty,questions) values(r,p_difficulty,p_questions);
  return query select r,m;
end; $$;

create or replace function public.quiz_buzz_start(p_room_id uuid, p_member_id uuid, p_expected_revision bigint) returns void
language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.quiz_buzz_games; host_member public.group_members; roster jsonb; q jsonb;
begin
  select * into room from public.group_rooms where id=p_room_id for update;
  select * into game from public.quiz_buzz_games where room_id=p_room_id for update;
  select * into host_member from public.group_members where id=p_member_id and room_id=p_room_id and role='host';
  if not found or room.game_type<>'quiz_buzz' or room.expires_at<=now() or room.status<>'lobby' or game.phase<>'lobby' or room.revision<>p_expected_revision then raise exception 'GROUP_STALE'; end if;
  if room.member_count<2 or room.member_count>8 then raise exception 'QUIZ_BUZZ_PARTICIPANTS'; end if;
  select coalesce(jsonb_object_agg(id,0),'{}'::jsonb) into roster from public.group_members where room_id=p_room_id;
  q := game.questions->0;
  insert into public.quiz_buzz_rounds(room_id,round_no,question_id,question_text,choices,correct_choice_id,explanation,phase,answer_due_at,overall_due_at)
    values(p_room_id,1,q->>'id',q->>'question',q->'choices',q->>'correctChoiceId',q->>'explanation','buzz',now()+interval '10 seconds',now()+interval '45 seconds');
  update public.quiz_buzz_games set phase='playing',round_no=1,question_index=0,scores=roster,revision=room.revision+1,updated_at=now() where room_id=p_room_id;
  update public.group_rooms set status='playing',revision=revision+1,updated_at=now() where id=p_room_id;
end; $$;

create or replace function public.quiz_buzz_claim(p_room_id uuid, p_member_id uuid, p_round_no integer, p_question_id text) returns uuid
language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.quiz_buzz_games; r public.quiz_buzz_rounds; m public.group_members; attempt public.quiz_buzz_attempts;
begin
  select * into room from public.group_rooms where id=p_room_id for update; select * into game from public.quiz_buzz_games where room_id=p_room_id for update;
  select * into r from public.quiz_buzz_rounds where room_id=p_room_id and round_no=p_round_no for update;
  select * into m from public.group_members where id=p_member_id and room_id=p_room_id;
  if not found or room.game_type<>'quiz_buzz' or room.expires_at<=now() or room.status<>'playing' or game.phase<>'playing' or game.round_no<>p_round_no or r.question_id<>p_question_id then raise exception 'QUIZ_BUZZ_STALE_ROUND'; end if;
  if r.phase<>'buzz' or now()>r.overall_due_at then raise exception 'QUIZ_BUZZ_CLOSED'; end if;
  if r.locked_member_ids ? p_member_id::text then raise exception 'QUIZ_BUZZ_LOCKED'; end if;
  if r.winner_member_id is not null then raise exception 'QUIZ_BUZZ_ALREADY_CLAIMED'; end if;
  insert into public.quiz_buzz_attempts(round_id,member_id) values(r.id,p_member_id) returning * into attempt;
  update public.quiz_buzz_rounds set phase='answer',winner_member_id=p_member_id,winner_claim_id=attempt.id,answer_due_at=now()+interval '10 seconds' where id=r.id;
  update public.quiz_buzz_games set revision=revision+1,updated_at=now() where room_id=p_room_id;
  update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id;
  return attempt.id;
end; $$;

create or replace function public.quiz_buzz_answer(p_room_id uuid, p_member_id uuid, p_round_no integer, p_question_id text, p_claim_id uuid, p_choice_id text) returns void
language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.quiz_buzz_games; r public.quiz_buzz_rounds; a public.quiz_buzz_attempts; correct boolean; locks jsonb;
begin
  select * into room from public.group_rooms where id=p_room_id for update; select * into game from public.quiz_buzz_games where room_id=p_room_id for update; select * into r from public.quiz_buzz_rounds where room_id=p_room_id and round_no=p_round_no for update;
  select * into a from public.quiz_buzz_attempts where id=p_claim_id and round_id=r.id and member_id=p_member_id for update;
  if not found or room.game_type<>'quiz_buzz' or room.expires_at<=now() or room.status<>'playing' or game.phase<>'playing' or game.round_no<>p_round_no or r.question_id<>p_question_id then raise exception 'QUIZ_BUZZ_STALE_ROUND'; end if;
  if r.phase<>'answer' or r.winner_member_id<>p_member_id or a.result<>'claimed' then raise exception 'QUIZ_BUZZ_CLOSED'; end if;
  if now()>r.answer_due_at or now()>r.overall_due_at then raise exception 'QUIZ_BUZZ_TIMEOUT'; end if;
  if not exists(select 1 from jsonb_array_elements(r.choices) c where c->>'id'=p_choice_id) then raise exception 'QUIZ_BUZZ_INVALID'; end if;
  correct := p_choice_id=r.correct_choice_id; locks := r.locked_member_ids;
  if correct then
    update public.quiz_buzz_attempts set answered_at=now(),choice_id=p_choice_id,result='correct' where id=a.id;
    update public.quiz_buzz_games set scores=jsonb_set(scores,array[p_member_id::text],to_jsonb(coalesce((scores->>p_member_id::text)::integer,0)+1),true),revision=revision+1,updated_at=now() where room_id=p_room_id;
    update public.quiz_buzz_rounds set phase='reveal',winner_choice_id=p_choice_id,winner_answered_at=now(),reveal_due_at=now()+interval '5 seconds' where id=r.id;
  else
    locks := locks || jsonb_build_array(p_member_id);
    update public.quiz_buzz_attempts set answered_at=now(),choice_id=p_choice_id,result='wrong' where id=a.id;
    update public.quiz_buzz_rounds set phase=case when jsonb_array_length(locks)>=room.member_count then 'reveal' else 'buzz' end,winner_member_id=null,winner_claim_id=null,winner_choice_id=null,reveal_due_at=case when jsonb_array_length(locks)>=room.member_count then now()+interval '5 seconds' else null end,locked_member_ids=locks where id=r.id;
    update public.quiz_buzz_games set revision=revision+1,updated_at=now() where room_id=p_room_id;
  end if;
  update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id;
end; $$;

create or replace function public.quiz_buzz_advance(p_room_id uuid, p_round_no integer default null, p_question_id text default null) returns void
language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; game public.quiz_buzz_games; r public.quiz_buzz_rounds; locks jsonb; nextq jsonb;
begin
  select * into room from public.group_rooms where id=p_room_id for update; select * into game from public.quiz_buzz_games where room_id=p_room_id for update; if not found or room.game_type<>'quiz_buzz' or room.expires_at<=now() or room.status='ended' or game.phase in ('lobby','complete') then return; end if;
  select * into r from public.quiz_buzz_rounds where room_id=p_room_id and round_no=game.round_no for update; if not found then return; end if;
  if p_round_no is not null and (p_round_no<>game.round_no or p_question_id is distinct from r.question_id) then raise exception 'QUIZ_BUZZ_STALE_ROUND'; end if;
  if r.phase='answer' and now()>r.answer_due_at then
    locks:=r.locked_member_ids||jsonb_build_array(r.winner_member_id); update public.quiz_buzz_attempts set result='timeout',answered_at=now() where round_id=r.id and result='claimed'; update public.quiz_buzz_rounds set phase=case when jsonb_array_length(locks)>=room.member_count then 'reveal' else 'buzz' end,winner_member_id=null,winner_claim_id=null,reveal_due_at=case when jsonb_array_length(locks)>=room.member_count then now()+interval '5 seconds' else null end,locked_member_ids=locks where id=r.id; update public.quiz_buzz_games set revision=revision+1,updated_at=now() where room_id=p_room_id; update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id;
  end if;
  if r.phase in ('buzz','answer') and now()>r.overall_due_at then update public.quiz_buzz_rounds set phase='reveal',winner_member_id=null,winner_claim_id=null,reveal_due_at=now()+interval '5 seconds' where id=r.id; update public.quiz_buzz_games set revision=revision+1,updated_at=now() where room_id=p_room_id; update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id; end if;
  if r.phase='reveal' and r.reveal_due_at<=now() then
    if game.round_no>=6 then update public.quiz_buzz_rounds set phase='complete' where id=r.id; update public.quiz_buzz_games set phase='complete',updated_at=now(),revision=revision+1 where room_id=p_room_id; update public.group_rooms set status='ended',revision=revision+1,updated_at=now() where id=p_room_id;
    else nextq:=game.questions->(game.question_index+1); insert into public.quiz_buzz_rounds(room_id,round_no,question_id,question_text,choices,correct_choice_id,explanation,phase,answer_due_at,overall_due_at) values(p_room_id,game.round_no+1,nextq->>'id',nextq->>'question',nextq->'choices',nextq->>'correctChoiceId',nextq->>'explanation','buzz',now()+interval '10 seconds',now()+interval '45 seconds'); update public.quiz_buzz_games set round_no=round_no+1,question_index=question_index+1,revision=revision+1,updated_at=now() where room_id=p_room_id; update public.group_rooms set revision=revision+1,updated_at=now() where id=p_room_id; end if;
  end if;
end; $$;

create or replace function public.quiz_buzz_finish(p_room_id uuid, p_member_id uuid, p_expected_revision bigint) returns void
language plpgsql security definer set search_path=public as $$
declare room public.group_rooms; m public.group_members;
begin
  select * into room from public.group_rooms where id=p_room_id for update; select * into m from public.group_members where id=p_member_id and room_id=p_room_id and role='host';
  if not found or room.game_type<>'quiz_buzz' or room.expires_at<=now() or room.revision<>p_expected_revision then raise exception 'GROUP_STALE'; end if;
  update public.quiz_buzz_games set phase='complete',updated_at=now(),revision=revision+1 where room_id=p_room_id; update public.group_rooms set status='ended',revision=revision+1,updated_at=now() where id=p_room_id;
end; $$;

revoke all on function public.quiz_buzz_create_room(uuid,text,text,text,timestamptz,text,jsonb), public.quiz_buzz_start(uuid,uuid,bigint), public.quiz_buzz_claim(uuid,uuid,integer,text), public.quiz_buzz_answer(uuid,uuid,integer,text,uuid,text), public.quiz_buzz_advance(uuid,integer,text), public.quiz_buzz_finish(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.quiz_buzz_create_room(uuid,text,text,text,timestamptz,text,jsonb), public.quiz_buzz_start(uuid,uuid,bigint), public.quiz_buzz_claim(uuid,uuid,integer,text), public.quiz_buzz_answer(uuid,uuid,integer,text,uuid,text), public.quiz_buzz_advance(uuid,integer,text), public.quiz_buzz_finish(uuid,uuid,bigint) to service_role;
commit;
