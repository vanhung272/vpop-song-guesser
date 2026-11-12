/** Room constants. Values marked [Đề xuất] in the plan are tunable. */

export const MAX_PLAYERS = 30;
export const ROOM_CODE_LENGTH = 5;
export const QUESTION_COUNT_OPTIONS = [5, 10, 15, 20] as const;
export const TIME_LIMIT_OPTIONS_MS = [10000, 15000, 20000] as const;
export const DEFAULT_TIME_LIMIT_MS = 15000;

/**
 * Speed-up factor for the fixed phase durations (countdown, round card, reveal), used by e2e
 * tests (R11a). Only honoured when E2E=1 or NODE_ENV=test, never in production; must be in (0, 1].
 */
export function timingScale(env: Record<string, string | undefined>): number {
  if (env.NODE_ENV === 'production') return 1;
  if (env.E2E !== '1' && env.NODE_ENV !== 'test') return 1;
  const scale = Number(env.ROOM_TIMING_SCALE);
  return env.ROOM_TIMING_SCALE && Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 1;
}

const SCALE = timingScale(typeof process === 'undefined' ? {} : process.env);

export const COUNTDOWN_MS = Math.round(3000 * SCALE);
export const CHOICE_COUNT = 4;

// [Đề xuất]
export const PRESENT_MS = Math.round(1500 * SCALE);
export const REVEAL_MS = Math.round(2000 * SCALE);
export const HEARTBEAT_MS = 15000;
export const OFFLINE_AFTER_MS = 45000;
export const ROOM_IDLE_CLOSE_MS = 30 * 60 * 1000;
