import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Phase, type Player, type RoomState } from './state-machine';
import { buildSnapshot, type AnswerRecord, type RoundRecord } from './snapshot';
import { pointsOnOffer } from './scoring';

const NOW = 1_800_000_000_000;

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  joinedAt: NOW - 60_000,
  joinedRound: 0,
  score: 0,
  lastSeenAt: NOW - 1000,
  leftAt: null,
  ...over,
});

const round = (idx: number): RoundRecord => ({
  idx,
  questionType: 'title',
  choices: [
    { answerId: `r${idx}-a`, label: `Bài A${idx}` },
    { answerId: `r${idx}-b`, label: `Bài B${idx}` },
    { answerId: `r${idx}-c`, label: `Bài C${idx}` },
    { answerId: `r${idx}-d`, label: `Bài D${idx}` },
  ],
  correctAnswerId: `r${idx}-c`,
  track: {
    title: `Bài C${idx}`,
    artist: `Ca Sĩ Bí Mật ${idx}`,
    coverUrl: `https://cover.test/${idx}.jpg`,
    previewUrl: `https://audio.test/${idx}.m4a`,
  },
});

const rounds = [0, 1, 2, 3, 4].map(round);

const profiles = {
  u1: { nickname: 'Một', avatarSeed: 's1' },
  u2: { nickname: 'Hai', avatarSeed: 's2' },
  u3: { nickname: 'Ba', avatarSeed: 's3' },
  u4: { nickname: 'Bốn', avatarSeed: 's4' },
};

function state(phase: Phase, roundIdx: number, over: Partial<RoomState> = {}): RoomState {
  return {
    phase,
    roundIdx,
    phaseEndsAt: phase === 'lobby' || phase === 'results' ? null : NOW + 5000,
    hostId: 'u1',
    gameNo: 1,
    version: 7,
    settings: { ...DEFAULT_SETTINGS, questionCount: 5 },
    theme: { type: 'genre', key: 'Pop' },
    players: [
      player('u1', { score: 1200 }),
      player('u2', { score: 1500 }),
      player('u3', { score: 0 }),
      player('u4', { score: 0, joinedRound: roundIdx + 1 }),
    ],
    ...over,
  };
}

// Round 1 (idx 1): u1 correct (fast), u2 correct (slow), u3 wrong.
const answersR1: AnswerRecord[] = [
  { idx: 1, playerId: 'u2', answerId: 'r1-c', answeredAt: NOW - 3000, points: 700 },
  { idx: 1, playerId: 'u1', answerId: 'r1-c', answeredAt: NOW - 4000, points: 700 },
  { idx: 1, playerId: 'u3', answerId: 'r1-a', answeredAt: NOW - 3500, points: 0 },
];
const answersR0: AnswerRecord[] = [
  { idx: 0, playerId: 'u1', answerId: 'r0-c', answeredAt: NOW - 30_000, points: 500 },
  { idx: 0, playerId: 'u2', answerId: 'r0-c', answeredAt: NOW - 31_000, points: 800 },
];

const ctx = { code: '12345', profiles, themeLabel: 'Pop' };

function snap(s: RoomState, answers: AnswerRecord[], viewer = 'u1') {
  return buildSnapshot(s, rounds, answers, viewer, NOW, ctx);
}

describe('buildSnapshot', () => {
  it('snapshot in question phase has no correctAnswerId and no track info', () => {
    const s = state('question', 1, { currentRound: { idx: 1, answeredPlayerIds: ['u1', 'u2', 'u3'] } });
    const out = snap(s, [...answersR0, ...answersR1]);
    expect(out.phase).toBe('question');
    expect(out.round?.idx).toBe(1);
    expect(out.round?.choices).toEqual(rounds[1].choices);
    expect(out.round?.reveal).toBeNull();

    const json = JSON.stringify(out);
    expect(json).not.toContain('correctAnswerId');
    expect(json).not.toContain('Ca Sĩ Bí Mật 1'); // artist of the current track
    expect(json).not.toContain('cover.test/1.jpg');
    expect(json).not.toContain('top3');
    // no other round's choices
    for (const idx of [0, 2, 3, 4]) expect(json).not.toContain(`r${idx}-b`);
    // own answer is shown without its points / correctness
    expect(out.round?.myAnswer).toEqual({ answerId: 'r1-c', points: null, correct: null });
    // scores do not move until reveal (a score jump would leak correctness)
    const scores = Object.fromEntries(out.players.map((p) => [p.id, p.score]));
    expect(scores).toEqual({ u1: 500, u2: 800, u3: 0, u4: 0 });
    // history only has the completed round 0
    expect(out.history.map((h) => h.idx)).toEqual([0]);
  });

  it('snapshot in presenting phase has audio but no choices or answer data', () => {
    const out = snap(state('presenting', 1), answersR0);
    expect(out.round?.audioUrl).toBe('https://audio.test/1.m4a');
    expect(out.round?.nextAudioUrl).toBe('https://audio.test/2.m4a');
    expect(out.round?.choices).toBeNull();
    expect(out.round?.reveal).toBeNull();
    expect(out.round?.pointsOnOffer).toEqual(pointsOnOffer(2));
    expect(out.round?.roundNumber).toBe(2);
    expect(JSON.stringify(out)).not.toContain('r1-');
  });

  it('snapshot in reveal phase includes correctAnswerId, top3 and track', () => {
    const s = state('reveal', 1, { currentRound: { idx: 1, answeredPlayerIds: ['u1', 'u2', 'u3'] } });
    const out = snap(s, [...answersR0, ...answersR1], 'u3');
    expect(out.round?.reveal).toEqual({
      correctAnswerId: 'r1-c',
      track: { title: 'Bài C1', artist: 'Ca Sĩ Bí Mật 1', coverUrl: 'https://cover.test/1.jpg' },
      // points desc, then answered_at asc; zero points excluded
      top3: [
        { playerId: 'u1', nickname: 'Một', points: 700 },
        { playerId: 'u2', nickname: 'Hai', points: 700 },
      ],
    });
    expect(out.round?.myAnswer).toEqual({ answerId: 'r1-a', points: 0, correct: false });
    expect(out.history.map((h) => h.idx)).toEqual([0, 1]);
    expect(out.history[1]).toMatchObject({ myAnswerId: 'r1-a', myPoints: 0, correct: false });
    // full scores in reveal, players sorted by score desc
    expect(out.players.map((p) => [p.id, p.score])).toEqual([
      ['u2', 1500],
      ['u1', 1200],
      ['u3', 0],
      ['u4', 0],
    ]);
  });

  it('live answer percentages appear only when showLiveAnswers is true', () => {
    const cur = { idx: 1, answeredPlayerIds: ['u1', 'u2', 'u3'] };
    const on = snap(state('question', 1, { currentRound: cur }), answersR1);
    expect(on.round?.livePercentages).toEqual({ 'r1-a': 33, 'r1-b': 0, 'r1-c': 67, 'r1-d': 0 });
    expect(on.round?.answeredCount).toBe(3);

    const off = snap(
      state('question', 1, {
        currentRound: cur,
        settings: { ...DEFAULT_SETTINGS, questionCount: 5, showLiveAnswers: false },
      }),
      answersR1,
    );
    expect(off.round?.livePercentages).toBeNull();
    expect(off.round?.answeredCount).toBe(3);

    const presenting = snap(state('presenting', 1), []);
    expect(presenting.round?.livePercentages).toBeNull();
  });

  it('marks host, online, membership and late joiners as spectators', () => {
    const s = state('question', 1, {
      players: [
        player('u1', { lastSeenAt: NOW - 120_000 }),
        player('u2'),
        player('u3', { leftAt: NOW - 1000 }),
        player('u4', { joinedRound: 2 }),
      ],
    });
    const out = snap(s, [], 'u4');
    expect(out.serverNowMs).toBe(NOW);
    expect(out.code).toBe('12345');
    expect(out.version).toBe(7);
    expect(out.viewerId).toBe('u4');
    expect(out.isHost).toBe(false);
    expect(out.isMember).toBe(true);
    expect(out.players.map((p) => p.id).sort()).toEqual(['u1', 'u2', 'u4']); // left player hidden
    const u1 = out.players.find((p) => p.id === 'u1')!;
    expect(u1).toMatchObject({ nickname: 'Một', avatarSeed: 's1', isHost: true, online: false });
    expect(out.players.find((p) => p.id === 'u2')!.online).toBe(true);
    expect(out.round?.canAnswer).toBe(false);
    expect(out.theme).toEqual({ type: 'genre', key: 'Pop', label: 'Pop' });

    const stranger = snap(s, [], 'zz');
    expect(stranger.isMember).toBe(false);
    expect(stranger.round?.canAnswer).toBe(false);
    expect(stranger.round?.myAnswer).toBeNull();
  });

  it('lobby and countdown carry no round data; results carry the full history', () => {
    expect(snap(state('lobby', 0), []).round).toBeNull();
    expect(snap(state('countdown', 0), []).round).toBeNull();
    expect(snap(state('countdown', 0), []).history).toEqual([]);
    const res = snap(state('results', 4), [...answersR0, ...answersR1]);
    expect(res.round).toBeNull();
    expect(res.history.map((h) => h.idx)).toEqual([0, 1, 2, 3, 4]);
    expect(res.history[0]).toMatchObject({
      track: { title: 'Bài C0', artist: 'Ca Sĩ Bí Mật 0', coverUrl: 'https://cover.test/0.jpg' },
      correctLabel: 'Bài C0',
      myAnswerId: 'r0-c',
      myPoints: 500,
      correct: true,
    });
  });

  // The service reads players (with score) and answers in two queries, so an answer can commit in
  // between: it is then in `answers` but not in `score` (or, read the other way round, the reverse).
  // Displayed scores must not depend on that race (Review Focus 1).
  describe('scores are consistent with the answers read (no race leak)', () => {
    const preRound = { u1: 500, u2: 800, u3: 0, u4: 0 }; // after round 0, before round 1
    const scoresOf = (out: ReturnType<typeof snap>) =>
      Object.fromEntries(out.players.map((p) => [p.id, p.score]));
    const withScores = (s: RoomState, scores: Record<string, number>): RoomState => ({
      ...s,
      players: s.players.map((p) => ({ ...p, score: scores[p.id] ?? 0 })),
    });
    const cur = { idx: 1, answeredPlayerIds: ['u1', 'u2', 'u3'] };

    it('question: an answer not yet reflected in score shows no drop and no current-round points', () => {
      // scores read BEFORE the round-1 answers committed, answers read AFTER
      const s = withScores(state('question', 1, { currentRound: cur }), preRound);
      const out = snap(s, [...answersR0, ...answersR1], 'u4');
      expect(scoresOf(out)).toEqual(preRound);
    });

    it('question: a score that already includes an answer missing from the answers read is not shown', () => {
      // scores read AFTER u1/u2 answered round 1 (+700 each), answers read without them
      const s = withScores(state('question', 1, { currentRound: cur }), { u1: 1200, u2: 1500 });
      const out = snap(s, [...answersR0], 'u4');
      expect(scoresOf(out)).toEqual(preRound);
    });

    it('reveal/results: scores agree with top3 and history from the same answers read', () => {
      const stale = withScores(state('reveal', 1, { currentRound: cur }), preRound);
      const out = snap(stale, [...answersR0, ...answersR1], 'u1');
      expect(scoresOf(out)).toEqual({ u1: 1200, u2: 1500, u3: 0, u4: 0 });
      expect(out.round?.reveal?.top3.map((t) => t.points)).toEqual([700, 700]);

      const res = snap(withScores(state('results', 4), { u1: 9999 }), [...answersR0, ...answersR1], 'u1');
      expect(scoresOf(res)).toEqual({ u1: 1200, u2: 1500, u3: 0, u4: 0 });
      expect(res.history.reduce((n, h) => n + h.myPoints, 0)).toBe(1200);
    });

    it('presenting: only revealed rounds count', () => {
      const s = withScores(state('presenting', 2), { u1: 1, u2: 2 });
      expect(scoresOf(snap(s, [...answersR0, ...answersR1]))).toEqual({ u1: 1200, u2: 1500, u3: 0, u4: 0 });
    });
  });
});
