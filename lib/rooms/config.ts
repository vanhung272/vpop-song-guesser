/** Room constants. Values marked [Đề xuất] in the plan are tunable. */

export const MAX_PLAYERS = 10;
export const ROOM_CODE_LENGTH = 5;
export const QUESTION_COUNT_OPTIONS = [5, 8, 10, 12, 15] as const;
export const TIME_LIMIT_OPTIONS_MS = [10000, 15000, 20000] as const;
export const DEFAULT_TIME_LIMIT_MS = 15000;
export const COUNTDOWN_MS = 3000;
export const CHOICE_COUNT = 4;

// [Đề xuất]
export const PRESENT_MS = 3000;
export const REVEAL_MS = 6000;
export const HEARTBEAT_MS = 15000;
export const OFFLINE_AFTER_MS = 45000;
export const ROOM_IDLE_CLOSE_MS = 30 * 60 * 1000;
