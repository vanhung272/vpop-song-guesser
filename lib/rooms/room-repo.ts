/**
 * Room persistence (service-role client only). Translates between DB rows and the pure
 * `RoomState` of `state-machine.ts`. Saves are optimistic: `room_save` (migration 0003) updates the
 * room only `where version = expected` and writes every effect in the same transaction.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ThemeType } from '@/lib/themes/themes';
import type { BuiltRound, QuestionType, ThemeRef, Track } from './round-builder';
import type { AnswerRecord, ProfileInfo, RoundRecord, SnapshotChoice } from './snapshot';
import { DEFAULT_SETTINGS, type Effect, type Phase, type Player, type RoomSettings, type RoomState } from './state-machine';

export interface LoadedRoom {
  roomId: string;
  code: string;
  state: RoomState;
  closedAt: number | null;
  lastActivityAt: number;
}

export interface SaveOptions {
  /** Server time of the command; becomes rooms.last_activity_at (monotonic). */
  nowMs: number;
  /** Required when `effects` contains CreateRounds: the rounds built for it, idx = array index. */
  rounds?: BuiltRound[];
}

export type SaveResult = 'ok' | 'conflict';

export interface RoomRepo {
  /** The open room with this code (closed_at is null), or null. Does not apply idle-close. */
  load(code: string): Promise<LoadedRoom | null>;
  /** Saves `next` iff the stored version still equals `prev.version`; else 'conflict', nothing written. */
  save(roomId: string, prev: RoomState, next: RoomState, effects: Effect[], opts: SaveOptions): Promise<SaveResult>;
  /** Monotonic last_seen_at (player) and last_activity_at (room). `playerId` null: room only. */
  touch(roomId: string, playerId: string | null, tsMs: number): Promise<void>;
  /** Closes an open room. */
  close(roomId: string, nowMs: number): Promise<void>;
  /** Inserts a new open room plus its host player row; 'code_taken' if the code is in use. */
  insertRoom(code: string, state: RoomState, nowMs: number): Promise<{ roomId: string } | 'code_taken'>;
  fetchRound(roomId: string, gameNo: number, idx: number): Promise<{ choices: SnapshotChoice[]; correctAnswerId: string } | null>;
  fetchGameRounds(roomId: string, gameNo: number): Promise<RoundRecord[]>;
  fetchGameAnswers(roomId: string, gameNo: number): Promise<AnswerRecord[]>;
  fetchProfiles(ids: string[]): Promise<Record<string, ProfileInfo>>;
  /** All Vietnamese tracks of a theme (ruling R4 keys). */
  fetchThemeTracks(theme: ThemeRef): Promise<Track[]>;
  countThemeTracks(theme: ThemeRef): Promise<number>;
}

// ----------------------------------------------------------------------------- helpers

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const msOf = (s: string): number => Date.parse(s);
const msOrNull = (s: string | null): number | null => (s === null ? null : Date.parse(s));

function fail(what: string, error: { message: string }): never {
  throw new Error(`room-repo ${what}: ${error.message}`);
}

interface PlayerRow {
  player_id: string;
  joined_at: string;
  joined_round: number;
  score: number;
  last_seen_at: string;
  left_at: string | null;
}

interface RoomRow {
  id: string;
  code: string;
  host_id: string;
  game_no: number;
  phase: Phase;
  round_idx: number;
  phase_ends_at: string | null;
  settings: Partial<RoomSettings> | null;
  theme_type: string | null;
  theme_key: string | null;
  version: number;
  last_activity_at: string;
  closed_at: string | null;
  room_players: PlayerRow[];
}

const ROOM_COLUMNS =
  'id, code, host_id, game_no, phase, round_idx, phase_ends_at, settings, theme_type, theme_key, ' +
  'version, last_activity_at, closed_at, ' +
  'room_players(player_id, joined_at, joined_round, score, last_seen_at, left_at)';

function parseSettings(raw: Partial<RoomSettings> | null): RoomSettings {
  const s = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    if (typeof raw.questionCount === 'number') s.questionCount = raw.questionCount;
    if (typeof raw.timeLimitMs === 'number') s.timeLimitMs = raw.timeLimitMs;
    if (typeof raw.showLiveAnswers === 'boolean') s.showLiveAnswers = raw.showLiveAnswers;
    if (typeof raw.lateJoin === 'boolean') s.lateJoin = raw.lateJoin;
  }
  return s;
}

function toPlayer(r: PlayerRow): Player {
  return {
    id: r.player_id,
    joinedAt: msOf(r.joined_at),
    joinedRound: r.joined_round,
    score: r.score,
    lastSeenAt: msOf(r.last_seen_at),
    leftAt: msOrNull(r.left_at),
  };
}

function playerPayload(p: Player) {
  return {
    player_id: p.id,
    joined_at: iso(p.joinedAt),
    joined_round: p.joinedRound,
    score: p.score,
    last_seen_at: iso(p.lastSeenAt),
    left_at: iso(p.leftAt),
  };
}

/** New players and players with any changed field. */
function changedPlayers(prev: RoomState, next: RoomState): Player[] {
  const before = new Map(prev.players.map((p) => [p.id, p]));
  return next.players.filter((p) => {
    const b = before.get(p.id);
    return (
      !b ||
      b.joinedAt !== p.joinedAt ||
      b.joinedRound !== p.joinedRound ||
      b.score !== p.score ||
      b.lastSeenAt !== p.lastSeenAt ||
      b.leftAt !== p.leftAt
    );
  });
}

// Method syntax (bivariant params) so any PostgREST filter builder fits.
function themeFilter<Q extends { eq(c: string, v: unknown): Q; contains(c: string, v: unknown): Q }>(
  q: Q,
  theme: ThemeRef,
): Q {
  switch (theme.type) {
    case 'artist':
      return q.contains('artist_keys', [theme.key]);
    case 'genre':
      return q.eq('genre', theme.key);
    case 'decade':
      return q.eq('decade', theme.key);
  }
}

const PAGE_SIZE = 1000;

// ----------------------------------------------------------------------------- repo

export function createRoomRepo(db: SupabaseClient): RoomRepo {
  return {
    async load(code) {
      const { data, error } = await db
        .from('rooms')
        .select(ROOM_COLUMNS)
        .eq('code', code)
        .is('closed_at', null)
        .maybeSingle();
      if (error) fail('load', error);
      if (!data) return null;
      const row = data as unknown as RoomRow;

      const players = row.room_players
        .map(toPlayer)
        .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const state: RoomState = {
        phase: row.phase,
        roundIdx: row.round_idx,
        phaseEndsAt: msOrNull(row.phase_ends_at),
        hostId: row.host_id,
        gameNo: row.game_no,
        version: row.version,
        settings: parseSettings(row.settings),
        theme:
          row.theme_type && row.theme_key
            ? { type: row.theme_type as ThemeType, key: row.theme_key }
            : null,
        players,
      };

      if (state.phase === 'question' || state.phase === 'reveal') {
        // Read after the room row: answers are insert-only, so this can only be a superset of what
        // the loaded version saw, which at worst turns a duplicate answer into ALREADY_ANSWERED.
        const ans = await db
          .from('room_answers')
          .select('player_id')
          .eq('room_id', row.id)
          .eq('game_no', state.gameNo)
          .eq('idx', state.roundIdx);
        if (ans.error) fail('load answers', ans.error);
        state.currentRound = {
          idx: state.roundIdx,
          answeredPlayerIds: (ans.data ?? []).map((a) => a.player_id as string),
        };
      }

      return {
        roomId: row.id,
        code: row.code,
        state,
        closedAt: msOrNull(row.closed_at),
        lastActivityAt: msOf(row.last_activity_at),
      };
    },

    async save(roomId, prev, next, effects, opts) {
      const rounds: object[] = [];
      const roundStarts: object[] = [];
      const answers: object[] = [];
      for (const e of effects) {
        switch (e.type) {
          case 'CreateRounds': {
            if (!opts.rounds || opts.rounds.length !== e.count) {
              throw new Error('room-repo save: CreateRounds needs exactly `count` built rounds');
            }
            opts.rounds.forEach((r, idx) =>
              rounds.push({
                game_no: e.gameNo,
                idx,
                track_id: r.trackId,
                question_type: r.questionType,
                choices: r.choices,
                correct_answer_id: r.correctAnswerId,
              }),
            );
            break;
          }
          case 'StartRound':
            roundStarts.push({
              game_no: e.gameNo,
              idx: e.idx,
              started_at: iso(e.startedAt),
              deadline_at: iso(e.deadlineAt),
            });
            break;
          case 'RecordAnswer':
            answers.push({
              game_no: e.gameNo,
              idx: e.idx,
              player_id: e.playerId,
              answer_id: e.answerId,
              answered_at: iso(e.answeredAt),
              points: e.points,
            });
            break;
          // AddScore / ResetScores / TouchPlayer are already reflected in next.players, which is
          // written below (score absolute from state; last_seen_at monotonic in SQL).
          default:
            break;
        }
      }

      const { data, error } = await db.rpc('room_save', {
        p_room_id: roomId,
        p_expected_version: prev.version,
        p_room: {
          phase: next.phase,
          round_idx: next.roundIdx,
          phase_ends_at: iso(next.phaseEndsAt),
          host_id: next.hostId,
          game_no: next.gameNo,
          settings: next.settings,
          theme_type: next.theme?.type ?? null,
          theme_key: next.theme?.key ?? null,
          version: next.version,
        },
        p_players: changedPlayers(prev, next).map(playerPayload),
        p_rounds: rounds,
        p_round_starts: roundStarts,
        p_answers: answers,
        p_now: iso(opts.nowMs),
      });
      if (error) fail('save', error);
      return data === true ? 'ok' : 'conflict';
    },

    async touch(roomId, playerId, tsMs) {
      const { error } = await db.rpc('touch_room_player', {
        p_room_id: roomId,
        p_player_id: playerId,
        p_ts: iso(tsMs),
      });
      if (error) fail('touch', error);
    },

    async close(roomId, nowMs) {
      const { error } = await db
        .from('rooms')
        .update({ closed_at: iso(nowMs) })
        .eq('id', roomId)
        .is('closed_at', null);
      if (error) fail('close', error);
    },

    async insertRoom(code, state, nowMs) {
      const { data, error } = await db
        .from('rooms')
        .insert({
          code,
          host_id: state.hostId,
          game_no: state.gameNo,
          phase: state.phase,
          round_idx: state.roundIdx,
          phase_ends_at: iso(state.phaseEndsAt),
          settings: state.settings,
          theme_type: state.theme?.type ?? null,
          theme_key: state.theme?.key ?? null,
          version: state.version,
          last_activity_at: iso(nowMs),
        })
        .select('id')
        .single();
      if (error) {
        if (error.code === '23505') return 'code_taken';
        fail('insert room', error);
      }
      const roomId = (data as { id: string }).id;
      const players = await db
        .from('room_players')
        .insert(state.players.map((p) => ({ room_id: roomId, ...playerPayload(p) })));
      if (players.error) {
        await db.from('rooms').delete().eq('id', roomId);
        fail('insert host player', players.error);
      }
      return { roomId };
    },

    async fetchRound(roomId, gameNo, idx) {
      const { data, error } = await db
        .from('room_rounds')
        .select('choices, correct_answer_id')
        .eq('room_id', roomId)
        .eq('game_no', gameNo)
        .eq('idx', idx)
        .maybeSingle();
      if (error) fail('fetch round', error);
      if (!data) return null;
      return { choices: data.choices as SnapshotChoice[], correctAnswerId: data.correct_answer_id as string };
    },

    async fetchGameRounds(roomId, gameNo) {
      const { data, error } = await db
        .from('room_rounds')
        .select('idx, question_type, choices, correct_answer_id, tracks(title, artist, cover_url, preview_url)')
        .eq('room_id', roomId)
        .eq('game_no', gameNo)
        .order('idx');
      if (error) fail('fetch rounds', error);
      return (data ?? []).map((r) => {
        const t = r.tracks as unknown as { title: string; artist: string; cover_url: string | null; preview_url: string };
        return {
          idx: r.idx as number,
          questionType: r.question_type as QuestionType,
          choices: r.choices as SnapshotChoice[],
          correctAnswerId: r.correct_answer_id as string,
          track: { title: t.title, artist: t.artist, coverUrl: t.cover_url, previewUrl: t.preview_url },
        };
      });
    },

    async fetchGameAnswers(roomId, gameNo) {
      const { data, error } = await db
        .from('room_answers')
        .select('idx, player_id, answer_id, answered_at, points')
        .eq('room_id', roomId)
        .eq('game_no', gameNo);
      if (error) fail('fetch answers', error);
      return (data ?? []).map((a) => ({
        idx: a.idx as number,
        playerId: a.player_id as string,
        answerId: a.answer_id as string,
        answeredAt: msOf(a.answered_at as string),
        points: a.points as number,
      }));
    },

    async fetchProfiles(ids) {
      if (ids.length === 0) return {};
      const { data, error } = await db.from('profiles').select('id, nickname, avatar_seed').in('id', ids);
      if (error) fail('fetch profiles', error);
      const out: Record<string, ProfileInfo> = {};
      for (const p of data ?? []) out[p.id as string] = { nickname: p.nickname as string, avatarSeed: p.avatar_seed as string };
      return out;
    },

    async fetchThemeTracks(theme) {
      const tracks: Track[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const q = db
          .from('tracks')
          .select('id, title, title_norm, artist, artist_norm, artist_keys, preview_url, cover_url')
          .eq('language', 'vi');
        const { data, error } = await themeFilter(q, theme)
          .order('itunes_track_id')
          .range(from, from + PAGE_SIZE - 1);
        if (error) fail('fetch theme tracks', error);
        for (const t of data ?? []) {
          tracks.push({
            id: t.id as string,
            title: t.title as string,
            titleNorm: t.title_norm as string,
            artist: t.artist as string,
            artistNorm: t.artist_norm as string,
            artistKeys: (t.artist_keys as string[] | null) ?? [],
            previewUrl: t.preview_url as string,
            coverUrl: (t.cover_url as string | null) ?? null,
          });
        }
        if (!data || data.length < PAGE_SIZE) break;
      }
      return tracks;
    },

    async countThemeTracks(theme) {
      const q = db.from('tracks').select('id', { count: 'exact', head: true }).eq('language', 'vi');
      const { count, error } = await themeFilter(q, theme);
      if (error) fail('count theme tracks', error);
      return count ?? 0;
    },
  };
}
