-- Room persistence functions (Task 7). Both are service-role only: EXECUTE is revoked from
-- public/anon/authenticated, so clients can never call them through PostgREST. RLS posture of the
-- room tables is unchanged (no policies, no grants to anon/authenticated).

-- ---------------------------------------------------------------------------
-- touch_room_player: heartbeat / activity. Monotonic: never moves a timestamp backwards, so a
-- late or stale write cannot undo a newer heartbeat. p_player_id may be null to bump only the
-- room's activity.
-- ---------------------------------------------------------------------------
create or replace function public.touch_room_player(p_room_id uuid, p_player_id uuid, p_ts timestamptz)
returns void
language sql
set search_path = ''
as $$
  update public.room_players
     set last_seen_at = greatest(last_seen_at, p_ts)
   where room_id = p_room_id and player_id = p_player_id;
  update public.rooms
     set last_activity_at = greatest(last_activity_at, p_ts)
   where id = p_room_id and closed_at is null;
$$;

-- ---------------------------------------------------------------------------
-- room_save: optimistic-concurrency save of one state-machine transition, in ONE transaction.
--   1. update rooms ... where id = p_room_id and version = p_expected_version and closed_at is null
--      -> no row: return false (someone else saved first, or the room closed); nothing is written.
--   2. upsert changed/new room_players. last_seen_at only moves forward (greatest), so a save
--      built from an older load never overwrites a newer heartbeat.
--   3. insert room_rounds (CreateRounds), stamp started_at/deadline_at (StartRound),
--      insert room_answers (RecordAnswer). Inserts are idempotent (on conflict do nothing).
-- Timestamps arrive as ISO strings; jsonb null -> SQL null.
-- ---------------------------------------------------------------------------
create or replace function public.room_save(
  p_room_id           uuid,
  p_expected_version  int,
  p_room              jsonb,
  p_players           jsonb default '[]'::jsonb,
  p_rounds            jsonb default '[]'::jsonb,
  p_round_starts      jsonb default '[]'::jsonb,
  p_answers           jsonb default '[]'::jsonb,
  p_now               timestamptz default now()
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.rooms
     set phase            = p_room->>'phase',
         round_idx        = (p_room->>'round_idx')::int,
         phase_ends_at    = (p_room->>'phase_ends_at')::timestamptz,
         host_id          = (p_room->>'host_id')::uuid,
         game_no          = (p_room->>'game_no')::int,
         settings         = p_room->'settings',
         theme_type       = p_room->>'theme_type',
         theme_key        = p_room->>'theme_key',
         version          = (p_room->>'version')::int,
         last_activity_at = greatest(last_activity_at, p_now)
   where id = p_room_id
     and version = p_expected_version
     and closed_at is null;
  if not found then
    return false;
  end if;

  insert into public.room_players as rp
         (room_id, player_id, joined_at, joined_round, score, last_seen_at, left_at)
  select p_room_id, p.player_id, p.joined_at, p.joined_round, p.score, p.last_seen_at, p.left_at
    from jsonb_to_recordset(p_players) as p(
           player_id uuid, joined_at timestamptz, joined_round int, score int,
           last_seen_at timestamptz, left_at timestamptz)
  on conflict (room_id, player_id) do update
     set joined_round = excluded.joined_round,
         score        = excluded.score,
         left_at      = excluded.left_at,
         last_seen_at = greatest(rp.last_seen_at, excluded.last_seen_at);

  insert into public.room_rounds
         (room_id, game_no, idx, track_id, question_type, choices, correct_answer_id)
  select p_room_id, r.game_no, r.idx, r.track_id, r.question_type, r.choices, r.correct_answer_id
    from jsonb_to_recordset(p_rounds) as r(
           game_no int, idx int, track_id uuid, question_type text, choices jsonb,
           correct_answer_id text)
  on conflict do nothing;

  update public.room_rounds rr
     set started_at = s.started_at,
         deadline_at = s.deadline_at
    from jsonb_to_recordset(p_round_starts) as s(
           game_no int, idx int, started_at timestamptz, deadline_at timestamptz)
   where rr.room_id = p_room_id and rr.game_no = s.game_no and rr.idx = s.idx;

  insert into public.room_answers (room_id, game_no, idx, player_id, answer_id, answered_at, points)
  select p_room_id, a.game_no, a.idx, a.player_id, a.answer_id, a.answered_at, a.points
    from jsonb_to_recordset(p_answers) as a(
           game_no int, idx int, player_id uuid, answer_id text, answered_at timestamptz,
           points int)
  on conflict do nothing;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: service_role only (Supabase default privileges grant EXECUTE to anon/authenticated).
-- ---------------------------------------------------------------------------
revoke all on function public.touch_room_player(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.room_save(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.touch_room_player(uuid, uuid, timestamptz) to service_role;
grant execute on function public.room_save(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz)
  to service_role;
