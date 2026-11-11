/**
 * Room service: wires the pure state machine to Postgres (room-repo) and Realtime (notify).
 *
 * Per command: load (idle-close) -> membership -> build command -> apply -> RoomError? -> no-op /
 * routine heartbeat? -> prepare (start: build rounds; theme: validate) -> optimistic save ->
 * 'conflict'? retry (user commands, up to MAX_ATTEMPTS) or accept (tick) -> notify(new version).
 *
 * Server time is read ONCE per request (`clock.now()` at receive time) and reused for every
 * attempt, so an answer is scored from deadline minus receive time (Review Focus 5).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { THEME_TYPES, PLAYABLE_MIN_TRACKS, themeLabel } from '@/lib/themes/themes';
import type { Clock } from './clock';
import { ROOM_CODE_LENGTH, ROOM_IDLE_CLOSE_MS } from './config';
import type { NotifyRoomChanged } from './notify';
import { createRoomRepo, type LoadedRoom, type RoomRepo } from './room-repo';
import { buildRounds, ThemeNotPlayableError, type BuiltRound, type Rng, type ThemeRef } from './round-builder';
import { buildSnapshot, type RoomSnapshot } from './snapshot';
import {
  apply,
  initialRoomState,
  isRoomError,
  type ApplyResult,
  type Command,
  type RoomError,
  type RoomSettings,
  type RoomState,
} from './state-machine';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RoomDeps {
  /** Service-role client. */
  db: SupabaseClient;
  clock: Clock;
  notify: NotifyRoomChanged;
  /** Used for the HEAD checks of preview URLs on start. */
  fetchFn: FetchLike;
  /** Room codes and round building. */
  rng: Rng;
  /** Defaults to createRoomRepo(db). */
  repo?: RoomRepo;
}

export type ServiceErrorCode =
  | RoomError
  | 'ROOM_NOT_FOUND'
  | 'NOT_IN_ROOM'
  | 'THEME_NOT_PLAYABLE'
  | 'INVALID_ANSWER'
  | 'CONFLICT'
  | 'CODE_UNAVAILABLE';

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; error: ServiceErrorCode };

export interface CommandResult {
  /** Room version after this call (the loaded version when nothing changed). */
  version: number;
  /** Whether this call changed the room (and broadcast). */
  changed: boolean;
}

export interface RoomService {
  createRoom(hostId: string): Promise<ServiceResult<{ code: string }>>;
  getSnapshot(code: string, viewerId: string): Promise<ServiceResult<RoomSnapshot>>;
  join(code: string, playerId: string): Promise<ServiceResult<CommandResult>>;
  leave(code: string, playerId: string): Promise<ServiceResult<CommandResult>>;
  heartbeat(code: string, playerId: string): Promise<ServiceResult<CommandResult>>;
  tick(code: string, playerId: string): Promise<ServiceResult<CommandResult>>;
  start(code: string, playerId: string): Promise<ServiceResult<CommandResult>>;
  rematch(code: string, playerId: string): Promise<ServiceResult<CommandResult>>;
  answer(code: string, playerId: string, answerId: string): Promise<ServiceResult<CommandResult>>;
  updateSettings(code: string, playerId: string, patch: Partial<RoomSettings>): Promise<ServiceResult<CommandResult>>;
  updateTheme(code: string, playerId: string, theme: ThemeRef): Promise<ServiceResult<CommandResult>>;
}

/** Save attempts for user commands on version conflict (ruling R7i); tick never retries. */
export const MAX_ATTEMPTS = 10;
/** Backoff before retry k (1-based) is uniform in [0, min(RETRY_MAX_WAIT_MS, RETRY_BASE_MS * 2^k)). */
export const RETRY_BASE_MS = 60;
export const RETRY_MAX_WAIT_MS = 250;
export const MAX_CODE_ATTEMPTS = 20;
export const HEAD_TIMEOUT_MS = 3000;
export const MAX_ROUND_BUILD_ATTEMPTS = 3;
const CODE_RE = new RegExp(`^[0-9]{${ROOM_CODE_LENGTH}}$`);

type Fail = Extract<ServiceResult<never>, { ok: false }>;
const fail = (status: Fail['status'], error: ServiceErrorCode): Fail => ({ ok: false, status, error });
const NOT_FOUND = fail(404, 'ROOM_NOT_FOUND');
const isFail = (x: unknown): x is Fail =>
  typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false;

const isMember = (state: RoomState, playerId: string) =>
  state.players.some((p) => p.id === playerId && p.leftAt === null);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RunSpec {
  /** Reject with 403 NOT_IN_ROOM unless the caller is an active player. */
  requireMember: boolean;
  /** Retry on save conflict (user commands); false for tick (a conflict means someone advanced). */
  retry: boolean;
  command(loaded: LoadedRoom): Promise<Command | Fail> | Command | Fail;
  /** After a successful, version-bumping apply and before saving (may do I/O; cache across attempts). */
  prepare?(loaded: LoadedRoom, result: ApplyResult): Promise<{ rounds?: BuiltRound[] } | Fail>;
}

export function createRoomService(deps: RoomDeps): RoomService {
  const { clock, notify, fetchFn, rng } = deps;
  const repo = deps.repo ?? createRoomRepo(deps.db);

  /** The open room, closing it first if it has been idle longer than ROOM_IDLE_CLOSE_MS. */
  async function loadOpen(code: string, nowMs: number): Promise<LoadedRoom | null> {
    if (!CODE_RE.test(code)) return null;
    const loaded = await repo.load(code);
    if (!loaded) return null;
    if (nowMs - loaded.lastActivityAt > ROOM_IDLE_CLOSE_MS) {
      if (await repo.close(loaded.roomId, nowMs, loaded.lastActivityAt)) return null;
      return repo.load(code); // someone was active after all: use the fresh row
    }
    return loaded;
  }

  async function safeNotify(code: string, version: number) {
    try {
      await notify(code, version);
    } catch (err) {
      // Clients also refetch on reconnect / their own actions; never fail a saved command.
      console.error(`notifyRoomChanged(${code}, ${version}) failed:`, err);
    }
  }

  async function run(code: string, playerId: string, spec: RunSpec): Promise<ServiceResult<CommandResult>> {
    const nowMs = clock.now(); // server receive time, reused by every attempt
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const loaded = await loadOpen(code, nowMs);
      if (!loaded) return NOT_FOUND;
      const { state } = loaded;
      if (spec.requireMember && !isMember(state, playerId)) return fail(403, 'NOT_IN_ROOM');

      const cmd = await spec.command(loaded);
      if (isFail(cmd)) return cmd;
      const result = apply(state, cmd, nowMs);
      if (isRoomError(result)) return fail(409, result);

      if (result.state === state) {
        await repo.touch(loaded.roomId, null, nowMs);
        return { ok: true, data: { version: state.version, changed: false } };
      }
      if (result.state.version === state.version) {
        // Routine heartbeat (R6f): persist last_seen_at only, no version check, no broadcast.
        for (const e of result.effects) {
          if (e.type === 'TouchPlayer') await repo.touch(loaded.roomId, e.playerId, e.lastSeenAt);
        }
        return { ok: true, data: { version: state.version, changed: false } };
      }

      const prepared = spec.prepare ? await spec.prepare(loaded, result) : {};
      if (isFail(prepared)) return prepared;

      const saved = await repo.save(loaded.roomId, state, result.state, result.effects, {
        nowMs,
        rounds: prepared.rounds,
      });
      if (saved === 'ok') {
        await safeNotify(loaded.code, result.state.version);
        return { ok: true, data: { version: result.state.version, changed: true } };
      }
      if (!spec.retry) return { ok: true, data: { version: state.version, changed: false } };
      // Exponential backoff with full jitter spreads competing writers (e.g. 10 answers at once).
      if (attempt < MAX_ATTEMPTS) {
        await sleep(Math.random() * Math.min(RETRY_MAX_WAIT_MS, RETRY_BASE_MS * 2 ** attempt));
      }
    }
    return fail(409, 'CONFLICT');
  }

  const simple = (type: 'Leave' | 'Heartbeat' | 'Start' | 'Rematch', retry = true) =>
    (code: string, playerId: string) =>
      run(code, playerId, { requireMember: true, retry, command: () => ({ type, playerId }) });

  // ---------------------------------------------------------------- start: rounds with HEAD checks

  async function previewOk(url: string): Promise<boolean> {
    try {
      const res = await fetchFn(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** buildRounds over the theme's tracks, replacing tracks whose preview fails a HEAD request. */
  async function buildCheckedRounds(theme: ThemeRef, count: number): Promise<BuiltRound[] | Fail> {
    let pool = await repo.fetchThemeTracks(theme);
    const urlOf = new Map(pool.map((t) => [t.id, t.previewUrl]));
    const verified = new Set<string>();
    for (let attempt = 1; attempt <= MAX_ROUND_BUILD_ATTEMPTS; attempt++) {
      let rounds: BuiltRound[];
      try {
        rounds = buildRounds(pool, theme, count, rng);
      } catch (err) {
        if (err instanceof ThemeNotPlayableError) return fail(409, 'THEME_NOT_PLAYABLE');
        throw err;
      }
      const urls = [...new Set(rounds.map((r) => urlOf.get(r.trackId)!))].filter((u) => !verified.has(u));
      const checks = await Promise.all(urls.map(async (u) => [u, await previewOk(u)] as const));
      const broken = new Set(checks.filter(([, okay]) => !okay).map(([u]) => u));
      for (const [u, okay] of checks) if (okay) verified.add(u);
      if (broken.size === 0) return rounds;
      pool = pool.filter((t) => !broken.has(t.previewUrl));
    }
    return fail(409, 'THEME_NOT_PLAYABLE');
  }

  // ---------------------------------------------------------------- service

  return {
    async createRoom(hostId) {
      const nowMs = clock.now();
      const state = initialRoomState({ hostId, nowMs });
      const span = 9 * 10 ** (ROOM_CODE_LENGTH - 1);
      for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
        const code = String(10 ** (ROOM_CODE_LENGTH - 1) + Math.floor(rng() * span));
        let res = await repo.insertRoom(code, state, nowMs);
        // An abandoned room keeps its code until something loads it: closing it here frees the code.
        if (res === 'code_taken' && !(await loadOpen(code, nowMs))) res = await repo.insertRoom(code, state, nowMs);
        if (res !== 'code_taken') return { ok: true, data: { code } };
      }
      return fail(503, 'CODE_UNAVAILABLE');
    },

    async getSnapshot(code, viewerId) {
      const nowMs = clock.now();
      const loaded = await loadOpen(code, nowMs);
      if (!loaded) return NOT_FOUND;
      const { state } = loaded;
      const hasRounds = state.phase !== 'lobby' && state.phase !== 'countdown';
      const [rounds, answers, profiles] = await Promise.all([
        hasRounds ? repo.fetchGameRounds(loaded.roomId, state.gameNo) : [],
        hasRounds ? repo.fetchGameAnswers(loaded.roomId, state.gameNo) : [],
        repo.fetchProfiles(state.players.map((p) => p.id)),
      ]);
      return {
        ok: true,
        data: buildSnapshot(state, rounds, answers, viewerId, nowMs, {
          code: loaded.code,
          profiles,
          themeLabel: state.theme ? themeLabel(state.theme) : null,
        }),
      };
    },

    join: (code, playerId) =>
      run(code, playerId, { requireMember: false, retry: true, command: () => ({ type: 'Join', playerId }) }),
    leave: simple('Leave'),
    heartbeat: simple('Heartbeat'),
    rematch: simple('Rematch'),
    tick: (code, playerId) =>
      run(code, playerId, { requireMember: true, retry: false, command: () => ({ type: 'Tick' }) }),

    start(code, playerId) {
      let cache: { key: string; rounds: BuiltRound[] } | null = null;
      return run(code, playerId, {
        requireMember: true,
        retry: true,
        command: () => ({ type: 'Start', playerId }),
        async prepare(_loaded, result) {
          const create = result.effects.find((e) => e.type === 'CreateRounds');
          if (!create) return {};
          const key = JSON.stringify([create.gameNo, create.count, create.theme.type, create.theme.key]);
          if (cache?.key !== key) {
            const rounds = await buildCheckedRounds(create.theme, create.count);
            if (isFail(rounds)) return rounds;
            cache = { key, rounds };
          }
          return { rounds: cache.rounds };
        },
      });
    },

    answer(code, playerId, answerId) {
      let round: { key: string; value: Awaited<ReturnType<RoomRepo['fetchRound']>> } | null = null;
      return run(code, playerId, {
        requireMember: true,
        retry: true,
        async command({ roomId, state }) {
          if (state.phase !== 'question') {
            return { type: 'Answer', playerId, answerId, isCorrect: false }; // -> WRONG_PHASE
          }
          const key = `${state.gameNo}:${state.roundIdx}`;
          if (round?.key !== key) {
            round = { key, value: await repo.fetchRound(roomId, state.gameNo, state.roundIdx) };
          }
          const r = round.value;
          if (!r || !r.choices.some((c) => c.answerId === answerId)) return fail(400, 'INVALID_ANSWER');
          return { type: 'Answer', playerId, answerId, isCorrect: answerId === r.correctAnswerId };
        },
      });
    },

    updateSettings: (code, playerId, patch) =>
      run(code, playerId, {
        requireMember: true,
        retry: true,
        command: () => ({ type: 'UpdateSettings', playerId, patch }),
      }),

    updateTheme(code, playerId, theme) {
      let playable: boolean | null = null;
      return run(code, playerId, {
        requireMember: true,
        retry: true,
        command: () => ({ type: 'UpdateTheme', playerId, theme }),
        async prepare() {
          if (!(THEME_TYPES as readonly string[]).includes(theme.type) || !theme.key) {
            return fail(409, 'THEME_NOT_PLAYABLE');
          }
          playable ??= (await repo.countThemeTracks(theme)) >= PLAYABLE_MIN_TRACKS;
          return playable ? {} : fail(409, 'THEME_NOT_PLAYABLE');
        },
      });
    },
  };
}
