-- Đoán Nhanh V-pop v1: catalog, profiles and room state.
--
-- Access model:
--   * tracks, profiles(id, nickname, avatar_seed): readable by anon/authenticated.
--   * rooms, room_players, room_rounds, room_answers: NO access for anon/authenticated.
--     Every read/write goes through the Next.js server with the service role (bypasses RLS).
--     room_rounds.correct_answer_id must never be readable by clients before the reveal phase.

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.tracks (
  id               uuid primary key default gen_random_uuid(),
  itunes_track_id  bigint not null unique,
  preview_url      text not null,
  title            text not null,
  title_norm       text not null,
  artist           text not null,
  artist_norm      text not null,
  language         text not null default 'vi',
  genre            text,
  decade           text,
  cover_url        text
);

create index tracks_artist_norm_idx on public.tracks (artist_norm);
create index tracks_genre_idx on public.tracks (genre);
create index tracks_decade_idx on public.tracks (decade);

-- ---------------------------------------------------------------------------
-- Profiles (one per Supabase auth user, including anonymous users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  nickname     text not null check (char_length(nickname) between 1 and 30),
  avatar_seed  text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Room state machine
-- Conventions: round index `idx` / `round_idx` is 0-based; `joined_round` is the first
-- 0-based round idx a player takes part in (0 = from the start of the game).
-- ---------------------------------------------------------------------------
create table public.rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null check (code ~ '^[0-9]{5}$'),
  host_id           uuid not null references public.profiles (id) on delete cascade,
  game_no           int not null default 1 check (game_no >= 1),
  phase             text not null default 'lobby'
                    check (phase in ('lobby', 'countdown', 'presenting', 'question', 'reveal', 'results')),
  round_idx         int not null default 0 check (round_idx >= 0),
  phase_ends_at     timestamptz,
  settings          jsonb not null default
                    '{"questionCount": 10, "timeLimitMs": 15000, "showLiveAnswers": true, "lateJoin": true}'::jsonb,
  theme_type        text,
  theme_key         text,
  version           int not null default 0,
  last_activity_at  timestamptz not null default now(),
  closed_at         timestamptz
);

-- A room code is unique among open rooms only, so codes of closed rooms can be reused.
create unique index rooms_code_open_uniq on public.rooms (code) where closed_at is null;
create index rooms_host_id_idx on public.rooms (host_id);

create table public.room_players (
  room_id        uuid not null references public.rooms (id) on delete cascade,
  player_id      uuid not null references public.profiles (id) on delete cascade,
  joined_at      timestamptz not null default now(),
  joined_round   int not null default 0 check (joined_round >= 0),
  score          int not null default 0,
  last_seen_at   timestamptz not null default now(),
  left_at        timestamptz,
  primary key (room_id, player_id)
);

create index room_players_player_id_idx on public.room_players (player_id);

create table public.room_rounds (
  room_id            uuid not null references public.rooms (id) on delete cascade,
  game_no            int not null check (game_no >= 1),
  idx                int not null check (idx >= 0),
  track_id           uuid not null references public.tracks (id),
  question_type      text not null check (question_type in ('title', 'artist')),
  choices            jsonb not null,           -- [{ "answerId": "...", "label": "..." }]
  correct_answer_id  text not null,
  started_at         timestamptz,
  deadline_at        timestamptz,
  primary key (room_id, game_no, idx)
);

create index room_rounds_track_id_idx on public.room_rounds (track_id);

create table public.room_answers (
  room_id      uuid not null,
  game_no      int not null,
  idx          int not null,
  player_id    uuid not null references public.profiles (id) on delete cascade,
  answer_id    text not null,
  answered_at  timestamptz not null default now(),
  points       int not null default 0,
  primary key (room_id, game_no, idx, player_id),
  foreign key (room_id, game_no, idx)
    references public.room_rounds (room_id, game_no, idx) on delete cascade
);

create index room_answers_player_id_idx on public.room_answers (player_id);

-- ---------------------------------------------------------------------------
-- Row level security: enabled on every table
-- ---------------------------------------------------------------------------
alter table public.tracks        enable row level security;
alter table public.profiles      enable row level security;
alter table public.rooms         enable row level security;
alter table public.room_players  enable row level security;
alter table public.room_rounds   enable row level security;
alter table public.room_answers  enable row level security;

-- Public read policies (catalog and display profile only).
create policy tracks_select_public on public.tracks
  for select to anon, authenticated using (true);

create policy profiles_select_public on public.profiles
  for select to anon, authenticated using (true);

-- The four room tables get NO policies: with RLS on, that denies everything to
-- anon/authenticated even if a privilege is granted by mistake later.

-- ---------------------------------------------------------------------------
-- Privileges (defense in depth: Supabase default privileges grant ALL to anon/authenticated)
-- ---------------------------------------------------------------------------
revoke all on public.tracks       from anon, authenticated;
revoke all on public.profiles     from anon, authenticated;
revoke all on public.rooms        from anon, authenticated;
revoke all on public.room_players from anon, authenticated;
revoke all on public.room_rounds  from anon, authenticated;
revoke all on public.room_answers from anon, authenticated;

grant select on public.tracks to anon, authenticated;
grant select (id, nickname, avatar_seed) on public.profiles to anon, authenticated;

-- service_role keeps full access (explicit, in case default privileges are changed).
grant all on public.tracks, public.profiles, public.rooms, public.room_players,
             public.room_rounds, public.room_answers to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: room tables must not be exposed via postgres_changes.
-- Game updates use Realtime Broadcast (version only), never table replication.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['rooms', 'room_players', 'room_rounds', 'room_answers'] loop
      if exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime drop table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;
