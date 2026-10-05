-- Explicitly saved private notes for one-person sessions. Typed answers are
-- never automatically written here; only this API's explicit PUT/PATCH operations create rows.
create table if not exists public.solo_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  slot_key text not null check (slot_key ~ '^(question:[^[:cntrl:]]+|summary:[1-7])$'),
  source_type text not null check (source_type in ('deck', 'set')),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 120),
  source_title text not null check (char_length(btrim(source_title)) between 1 and 120),
  question_id text,
  question_text text,
  round_number smallint not null check (round_number between 1 and 7),
  slot_kind text not null check (slot_kind in ('question', 'summary')),
  note text not null check (char_length(note) between 1 and 2000),
  r18 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint solo_notes_slot_shape check (
    (slot_kind = 'question' and question_id is not null and question_text is not null and slot_key = 'question:' || question_id)
    or (slot_kind = 'summary' and question_id is null and question_text is null and slot_key = 'summary:' || round_number::text)
  ),
  unique (user_id, session_id, slot_key)
);
alter table public.solo_notes add column if not exists r18 boolean not null default false;

create index if not exists solo_notes_user_created_idx on public.solo_notes(user_id, created_at desc, id desc);
create index if not exists solo_notes_user_session_idx on public.solo_notes(user_id, session_id, created_at desc, id desc);
alter table public.solo_notes enable row level security;
drop policy if exists solo_notes_owner_select on public.solo_notes;
create policy solo_notes_owner_select on public.solo_notes for select to authenticated using (auth.uid() = user_id and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
drop policy if exists solo_notes_owner_insert on public.solo_notes;
create policy solo_notes_owner_insert on public.solo_notes for insert to authenticated with check (auth.uid() = user_id and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
drop policy if exists solo_notes_owner_update on public.solo_notes;
create policy solo_notes_owner_update on public.solo_notes for update to authenticated using (auth.uid() = user_id and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false) with check (auth.uid() = user_id and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
drop policy if exists solo_notes_owner_delete on public.solo_notes;
create policy solo_notes_owner_delete on public.solo_notes for delete to authenticated using (auth.uid() = user_id and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
revoke all on public.solo_notes from anon;
grant select, insert, update, delete on public.solo_notes to authenticated;

create or replace function public.set_solo_notes_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists solo_notes_updated_at on public.solo_notes;
create trigger solo_notes_updated_at before update on public.solo_notes for each row execute function public.set_solo_notes_updated_at();

create or replace function public.prevent_solo_note_snapshot_change() returns trigger language plpgsql as $$
begin
  new.id := old.id; new.user_id := old.user_id; new.session_id := old.session_id;
  new.slot_key := old.slot_key; new.source_type := old.source_type; new.source_id := old.source_id;
  new.source_title := old.source_title; new.question_id := old.question_id; new.question_text := old.question_text;
  new.round_number := old.round_number; new.slot_kind := old.slot_kind; new.created_at := old.created_at;
  new.r18 := old.r18;
  return new;
end;
$$;
drop trigger if exists solo_notes_snapshot_guard on public.solo_notes;
create trigger solo_notes_snapshot_guard before update on public.solo_notes for each row execute function public.prevent_solo_note_snapshot_change();
