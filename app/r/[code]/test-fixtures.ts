import type { RoomSnapshot, SnapshotPlayer, SnapshotRound } from '@/lib/rooms/snapshot';

/** Test helpers for room UI tests (not shipped: only imported by *.test.tsx). */
export function player(id: string, overrides: Partial<SnapshotPlayer> = {}): SnapshotPlayer {
  return {
    id,
    nickname: `Người ${id}`,
    avatarSeed: `seed-${id}`,
    score: 0,
    online: true,
    isHost: false,
    joinedRound: 0,
    hasAnswered: false,
    ...overrides,
  };
}

export const T0 = 1_700_000_000_000;

export function round(overrides: Partial<SnapshotRound> = {}): SnapshotRound {
  return {
    idx: 0,
    roundNumber: 1,
    questionType: 'title',
    pointsOnOffer: { base: 500, maxBonus: 300 },
    audioUrl: 'https://audio.test/a.m4a',
    nextAudioUrl: 'https://audio.test/b.m4a',
    canAnswer: true,
    choices: [
      { answerId: 'a1', label: 'Bài Một' },
      { answerId: 'a2', label: 'Bài Hai' },
      { answerId: 'a3', label: 'Bài Ba' },
      { answerId: 'a4', label: 'Bài Bốn' },
    ],
    myAnswer: null,
    answeredCount: 0,
    livePercentages: null,
    reveal: null,
    ...overrides,
  };
}

export function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    serverNowMs: T0,
    code: '12345',
    version: 10,
    phase: 'question',
    phaseEndsAt: T0 + 10_000,
    roundIdx: 0,
    questionCount: 5,
    gameNo: 1,
    hostId: 'h',
    viewerId: 'g',
    isHost: false,
    isMember: true,
    settings: { questionCount: 5, timeLimitMs: 15000, showLiveAnswers: true, lateJoin: true },
    theme: { type: 'genre', key: 'Pop', label: 'Pop', parts: ['Pop'] },
    players: [player('h', { isHost: true, nickname: 'Bảo' }), player('g', { nickname: 'Khách' })],
    round: round(),
    history: [],
    ...overrides,
  };
}
