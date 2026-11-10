/**
 * Pure room state machine. No DB, no clock, no randomness: time comes in as
 * `nowMs`. The service (Task 7) loads a `RoomState`, calls `apply`, executes
 * the returned effects and saves the new state with an optimistic check on
 * `version`.
 *
 * Version rule: every state change bumps `version` by exactly 1. A no-op
 * returns the identical state object and no effects. The one exception is a
 * routine `Heartbeat` (see `TouchPlayer`), which returns a new state with the
 * SAME version: the service persists `lastSeenAt` only and does not notify.
 * So: notify (broadcast) iff `result.state.version !== input.version`.
 */
import {
  COUNTDOWN_MS,
  DEFAULT_TIME_LIMIT_MS,
  MAX_PLAYERS,
  OFFLINE_AFTER_MS,
  PRESENT_MS,
  QUESTION_COUNT_OPTIONS,
  REVEAL_MS,
  TIME_LIMIT_OPTIONS_MS,
} from './config';
import type { ThemeRef } from './round-builder';
import { pointsFor } from './scoring';

export type Phase = 'lobby' | 'countdown' | 'presenting' | 'question' | 'reveal' | 'results';

export interface RoomSettings {
  questionCount: number;
  timeLimitMs: number;
  showLiveAnswers: boolean;
  lateJoin: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  questionCount: 10,
  timeLimitMs: DEFAULT_TIME_LIMIT_MS,
  showLiveAnswers: true,
  lateJoin: true,
};

export interface Player {
  id: string;
  joinedAt: number;
  /** 0-based index of the first round this player may answer. */
  joinedRound: number;
  score: number;
  lastSeenAt: number;
  leftAt: number | null;
}

export interface CurrentRound {
  idx: number;
  answeredPlayerIds: string[];
}

export interface RoomState {
  phase: Phase;
  /** 0-based. */
  roundIdx: number;
  phaseEndsAt: number | null;
  hostId: string;
  gameNo: number;
  version: number;
  settings: RoomSettings;
  theme: ThemeRef | null;
  players: Player[];
  /** Present in question/reveal; the service loads it from room_answers. */
  currentRound?: CurrentRound;
}

export type Command =
  | { type: 'Start'; playerId: string }
  | { type: 'Tick' }
  | { type: 'Answer'; playerId: string; answerId: string; isCorrect: boolean }
  | { type: 'Join'; playerId: string }
  | { type: 'Leave'; playerId: string }
  | { type: 'Heartbeat'; playerId: string }
  | { type: 'UpdateSettings'; playerId: string; patch: Partial<RoomSettings> }
  | { type: 'UpdateTheme'; playerId: string; theme: ThemeRef }
  | { type: 'Rematch'; playerId: string };

export type Effect =
  /** Build and insert room_rounds for this game (idx 0..count-1). */
  | { type: 'CreateRounds'; gameNo: number; count: number; theme: ThemeRef }
  /** Entering question(idx): stamp room_rounds.started_at / deadline_at. */
  | { type: 'StartRound'; gameNo: number; idx: number; startedAt: number; deadlineAt: number }
  /** Insert into room_answers. */
  | {
      type: 'RecordAnswer';
      gameNo: number;
      idx: number;
      playerId: string;
      answerId: string;
      answeredAt: number;
      points: number;
    }
  /** Incremental score change (already reflected in state.players[].score). */
  | { type: 'AddScore'; playerId: string; points: number }
  /** All room_players.score = 0 for the new game (already reflected in state). */
  | { type: 'ResetScores'; gameNo: number }
  /** Persist room_players.last_seen_at (already reflected in state). Emitted by every Heartbeat. */
  | { type: 'TouchPlayer'; playerId: string; lastSeenAt: number };

export type RoomError =
  | 'NOT_HOST'
  | 'WRONG_PHASE'
  | 'ROOM_FULL'
  | 'LATE_JOIN_CLOSED'
  | 'ALREADY_ANSWERED'
  | 'TOO_LATE'
  | 'NOT_IN_ROUND'
  | 'THEME_REQUIRED'
  | 'INVALID_SETTINGS';

export interface ApplyResult {
  state: RoomState;
  effects: Effect[];
}

export function isRoomError(result: ApplyResult | RoomError): result is RoomError {
  return typeof result === 'string';
}

/** A new lobby with the host as the only player. */
export function initialRoomState(args: {
  hostId: string;
  nowMs: number;
  settings?: RoomSettings;
  theme?: ThemeRef | null;
}): RoomState {
  const { hostId, nowMs } = args;
  return {
    phase: 'lobby',
    roundIdx: 0,
    phaseEndsAt: null,
    hostId,
    gameNo: 1,
    version: 0,
    settings: { ...(args.settings ?? DEFAULT_SETTINGS) },
    theme: args.theme ?? null,
    players: [newPlayer(hostId, nowMs, 0)],
  };
}

export function isOnline(player: Player, nowMs: number): boolean {
  return player.leftAt === null && nowMs - player.lastSeenAt <= OFFLINE_AFTER_MS;
}

/** Players currently in the room (not left), online or not. */
export function activePlayers(state: RoomState): Player[] {
  return state.players.filter((p) => p.leftAt === null);
}

/**
 * Who should be host at `nowMs`: the current host if online, otherwise the
 * online player with the smallest joinedAt (tie → id). Nobody online → unchanged.
 */
export function resolveHost(state: RoomState, nowMs: number): string {
  const current = state.players.find((p) => p.id === state.hostId);
  if (current && isOnline(current, nowMs)) return state.hostId;
  const candidates = state.players
    .filter((p) => isOnline(p, nowMs))
    .sort((x, y) => x.joinedAt - y.joinedAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return candidates[0]?.id ?? state.hostId;
}

/** Duration of a timed phase; null for lobby/results. */
export function phaseDurationMs(phase: Phase, settings: RoomSettings): number | null {
  switch (phase) {
    case 'countdown':
      return COUNTDOWN_MS;
    case 'presenting':
      return PRESENT_MS;
    case 'question':
      return settings.timeLimitMs;
    case 'reveal':
      return REVEAL_MS;
    default:
      return null;
  }
}

export function apply(state: RoomState, cmd: Command, nowMs: number): ApplyResult | RoomError {
  switch (cmd.type) {
    case 'Start':
      return start(state, cmd.playerId, nowMs);
    case 'Tick':
      return tick(state, nowMs);
    case 'Answer':
      return answer(state, cmd, nowMs);
    case 'Join':
      return join(state, cmd.playerId, nowMs);
    case 'Leave':
      return leave(state, cmd.playerId, nowMs);
    case 'Heartbeat':
      return heartbeat(state, cmd.playerId, nowMs);
    case 'UpdateSettings':
      return updateSettings(state, cmd.playerId, cmd.patch);
    case 'UpdateTheme':
      return updateTheme(state, cmd.playerId, cmd.theme);
    case 'Rematch':
      return rematch(state, cmd.playerId);
  }
}

// ---------------------------------------------------------------------------

function newPlayer(id: string, nowMs: number, joinedRound: number): Player {
  return { id, joinedAt: nowMs, joinedRound, score: 0, lastSeenAt: nowMs, leftAt: null };
}

function noop(state: RoomState): ApplyResult {
  return { state, effects: [] };
}

function changed(state: RoomState, effects: Effect[] = []): ApplyResult {
  return { state: { ...state, version: state.version + 1 }, effects };
}

function withPlayer(state: RoomState, id: string, update: (p: Player) => Player): RoomState {
  return { ...state, players: state.players.map((p) => (p.id === id ? update(p) : p)) };
}

function hostOnlyIn(state: RoomState, playerId: string, phase: Phase): RoomError | null {
  if (playerId !== state.hostId) return 'NOT_HOST';
  if (state.phase !== phase) return 'WRONG_PHASE';
  return null;
}

function start(state: RoomState, playerId: string, nowMs: number): ApplyResult | RoomError {
  const denied = hostOnlyIn(state, playerId, 'lobby');
  if (denied) return denied;
  if (!state.theme) return 'THEME_REQUIRED';
  const next: RoomState = {
    ...state,
    phase: 'countdown',
    roundIdx: 0,
    phaseEndsAt: nowMs + COUNTDOWN_MS,
  };
  delete next.currentRound;
  return changed(next, [
    { type: 'CreateRounds', gameNo: state.gameNo, count: state.settings.questionCount, theme: state.theme },
  ]);
}

function tick(state: RoomState, nowMs: number): ApplyResult {
  let next = state;
  const effects: Effect[] = [];

  if (state.phaseEndsAt !== null && nowMs >= state.phaseEndsAt) {
    const advanced = advancePhase(state, nowMs);
    next = advanced.state;
    effects.push(...advanced.effects);
  }

  const hostId = resolveHost(next, nowMs);
  if (hostId !== next.hostId) next = { ...next, hostId };

  return next === state ? noop(state) : changed(next, effects);
}

/** Exactly one phase transition (caller has checked the deadline). */
function advancePhase(state: RoomState, nowMs: number): ApplyResult {
  const enter = (phase: Phase, roundIdx: number): RoomState => {
    const duration = phaseDurationMs(phase, state.settings);
    const next: RoomState = {
      ...state,
      phase,
      roundIdx,
      phaseEndsAt: duration === null ? null : nowMs + duration,
    };
    if (phase === 'question') next.currentRound = { idx: roundIdx, answeredPlayerIds: [] };
    else if (phase !== 'reveal') delete next.currentRound;
    return next;
  };

  switch (state.phase) {
    case 'countdown':
      return { state: enter('presenting', 0), effects: [] };
    case 'presenting': {
      const next = enter('question', state.roundIdx);
      return {
        state: next,
        effects: [
          {
            type: 'StartRound',
            gameNo: state.gameNo,
            idx: state.roundIdx,
            startedAt: nowMs,
            deadlineAt: next.phaseEndsAt!,
          },
        ],
      };
    }
    case 'question':
      return { state: enter('reveal', state.roundIdx), effects: [] };
    case 'reveal': {
      const nextIdx = state.roundIdx + 1;
      return nextIdx < state.settings.questionCount
        ? { state: enter('presenting', nextIdx), effects: [] }
        : { state: enter('results', state.roundIdx), effects: [] };
    }
    default:
      return { state, effects: [] };
  }
}

function answer(
  state: RoomState,
  cmd: Extract<Command, { type: 'Answer' }>,
  nowMs: number,
): ApplyResult | RoomError {
  if (state.phase !== 'question' || state.phaseEndsAt === null) return 'WRONG_PHASE';
  if (nowMs > state.phaseEndsAt) return 'TOO_LATE';
  const player = state.players.find((p) => p.id === cmd.playerId);
  if (!player || player.leftAt !== null || player.joinedRound > state.roundIdx) {
    return 'NOT_IN_ROUND';
  }
  const answered =
    state.currentRound?.idx === state.roundIdx ? state.currentRound.answeredPlayerIds : [];
  if (answered.includes(cmd.playerId)) return 'ALREADY_ANSWERED';

  const points = pointsFor(
    state.roundIdx + 1,
    cmd.isCorrect,
    state.phaseEndsAt - nowMs,
    state.settings.timeLimitMs,
  );
  const next: RoomState = {
    ...withPlayer(state, cmd.playerId, (p) => ({ ...p, score: p.score + points })),
    currentRound: { idx: state.roundIdx, answeredPlayerIds: [...answered, cmd.playerId] },
  };
  return changed(next, [
    {
      type: 'RecordAnswer',
      gameNo: state.gameNo,
      idx: state.roundIdx,
      playerId: cmd.playerId,
      answerId: cmd.answerId,
      answeredAt: nowMs,
      points,
    },
    { type: 'AddScore', playerId: cmd.playerId, points },
  ]);
}

function join(state: RoomState, playerId: string, nowMs: number): ApplyResult | RoomError {
  const existing = state.players.find((p) => p.id === playerId);
  if (existing && existing.leftAt === null) return noop(state);
  if (activePlayers(state).length >= MAX_PLAYERS) return 'ROOM_FULL';

  if (existing) {
    // Returning player (R6c): restore, keep score/joinedRound, no late-join check.
    return changed(withPlayer(state, playerId, (p) => ({ ...p, leftAt: null, lastSeenAt: nowMs })));
  }

  let joinedRound: number;
  switch (state.phase) {
    case 'lobby':
    case 'results':
      joinedRound = 0;
      break;
    case 'countdown':
      if (!state.settings.lateJoin) return 'LATE_JOIN_CLOSED';
      joinedRound = 0;
      break;
    default:
      if (!state.settings.lateJoin) return 'LATE_JOIN_CLOSED';
      joinedRound = state.roundIdx + 1;
  }
  return changed({ ...state, players: [...state.players, newPlayer(playerId, nowMs, joinedRound)] });
}

function leave(state: RoomState, playerId: string, nowMs: number): ApplyResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.leftAt !== null) return noop(state);
  const next = withPlayer(state, playerId, (p) => ({ ...p, leftAt: nowMs }));
  return changed({ ...next, hostId: resolveHost(next, nowMs) });
}

function heartbeat(state: RoomState, playerId: string, nowMs: number): ApplyResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.leftAt !== null) return noop(state);

  const wasOffline = !isOnline(player, nowMs);
  const touched = withPlayer(state, playerId, (p) => ({ ...p, lastSeenAt: nowMs }));
  const hostId = resolveHost(touched, nowMs);
  const effects: Effect[] = [{ type: 'TouchPlayer', playerId, lastSeenAt: nowMs }];

  if (wasOffline || hostId !== state.hostId) return changed({ ...touched, hostId }, effects);
  return { state: touched, effects }; // same version: persist lastSeenAt, don't notify
}

const SETTING_VALIDATORS: Record<keyof RoomSettings, (v: unknown) => boolean> = {
  questionCount: (v) => (QUESTION_COUNT_OPTIONS as readonly unknown[]).includes(v),
  timeLimitMs: (v) => (TIME_LIMIT_OPTIONS_MS as readonly unknown[]).includes(v),
  showLiveAnswers: (v) => typeof v === 'boolean',
  lateJoin: (v) => typeof v === 'boolean',
};

function updateSettings(
  state: RoomState,
  playerId: string,
  patch: Partial<RoomSettings>,
): ApplyResult | RoomError {
  const denied = hostOnlyIn(state, playerId, 'lobby');
  if (denied) return denied;
  if (typeof patch !== 'object' || patch === null) return 'INVALID_SETTINGS';

  const settings: RoomSettings = { ...state.settings };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(SETTING_VALIDATORS, key)) return 'INVALID_SETTINGS';
    const k = key as keyof RoomSettings;
    if (!SETTING_VALIDATORS[k](value)) return 'INVALID_SETTINGS';
    (settings as unknown as Record<string, unknown>)[k] = value;
  }

  const same = (Object.keys(settings) as (keyof RoomSettings)[]).every(
    (k) => settings[k] === state.settings[k],
  );
  return same ? noop(state) : changed({ ...state, settings });
}

function updateTheme(state: RoomState, playerId: string, theme: ThemeRef): ApplyResult | RoomError {
  const denied = hostOnlyIn(state, playerId, 'lobby');
  if (denied) return denied;
  return changed({ ...state, theme: { type: theme.type, key: theme.key } });
}

function rematch(state: RoomState, playerId: string): ApplyResult | RoomError {
  const denied = hostOnlyIn(state, playerId, 'results');
  if (denied) return denied;
  const gameNo = state.gameNo + 1;
  const next: RoomState = {
    ...state,
    phase: 'lobby',
    gameNo,
    roundIdx: 0,
    phaseEndsAt: null,
    // joinedRound reset for everyone (also players who left) so a returning
    // player is never locked out by a stale joinedRound from the previous game.
    players: state.players.map((p) => ({ ...p, score: 0, joinedRound: 0 })),
  };
  delete next.currentRound;
  return changed(next, [{ type: 'ResetScores', gameNo }]);
}
