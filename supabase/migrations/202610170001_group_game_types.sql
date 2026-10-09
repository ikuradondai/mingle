-- Shared game_type CHECK for the group room game table (ochi_kara / one_cut / mission_mingle).
-- The server allow-list (server-side/group-rooms.mjs GAME_TYPES) already registers all three games;
-- this constraint lets the DB accept them so each new game's migration need not rewrite the constraint.
-- Added in two steps (not valid, then validate) so the table is checked without holding a long lock.
begin;
alter table public.group_rooms drop constraint if exists group_rooms_game_type;
alter table public.group_rooms add constraint group_rooms_game_type
  check (game_type in ('cards','minority_topic','question_wolf','ochi_kara','one_cut','mission_mingle')) not valid;
alter table public.group_rooms validate constraint group_rooms_game_type;
commit;
