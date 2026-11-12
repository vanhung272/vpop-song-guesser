import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_MS,
  DEFAULT_TIME_LIMIT_MS,
  MAX_PLAYERS,
  OFFLINE_AFTER_MS,
  PRESENT_MS,
  REVEAL_MS,
} from './config';
import { pointsFor } from './scoring';
import {
  apply,
  initialRoomState,
  isOnline,
  isRoomError,
  type ApplyResult,
  type Command,
  type Player,
  type RoomError,
  type RoomState,
} from './state-machine';

const THEME = { type: 'artist', key: 'son tung m-tp' } as const;

function player(id: string, joinedAt: number, extra: Partial<Player> = {}): Player {
  return { id, joinedAt, joinedRound: 0, score: 0, lastSeenAt: joinedAt, leftAt: null, ...extra };
}

/** Lobby with host `h` and players `a`, `b`, a theme set, everyone seen at t=1000. */
function lobby(overrides: Partial<RoomState> = {}): RoomState {
  const base = initialRoomState({ hostId: 'h', nowMs: 0 });
  return {
    ...base,
    theme: THEME,
    players: [
      player('h', 0, { lastSeenAt: 1000 }),
      player('a', 100, { lastSeenAt: 1000 }),
      player('b', 200, { lastSeenAt: 1000 }),
    ],
    ...overrides,
  };
}

function ok(result: ApplyResult | RoomError): ApplyResult {
  if (isRoomError(result)) throw new Error(`expected success, got ${result}`);
  return result;
}

function err(result: ApplyResult | RoomError): RoomError {
  if (!isRoomError(result)) throw new Error(`expected error, got phase ${result.state.phase}`);
  return result;
}

/** A room in question phase of round `roundIdx`, deadline at t=20000. */
function inQuestion(roundIdx = 0, answeredPlayerIds: string[] = []): RoomState {
  return lobby({
    phase: 'question',
    roundIdx,
    phaseEndsAt: 20000,
    version: 7,
    currentRound: { idx: roundIdx, answeredPlayerIds },
  });
}

describe('initialRoomState', () => {
  it('creates a lobby with the host as the first player and default settings', () => {
    const s = initialRoomState({ hostId: 'h', nowMs: 500 });
    expect(s).toMatchObject({
      phase: 'lobby',
      roundIdx: 0,
      phaseEndsAt: null,
      hostId: 'h',
      gameNo: 1,
      version: 0,
      theme: null,
      settings: {
        questionCount: 10,
        timeLimitMs: 15000, // product default: 15 s
        showLiveAnswers: true,
        lateJoin: true,
      },
    });
    expect(s.players).toEqual([player('h', 500)]);
  });
});

describe('isOnline', () => {
  it('is online within OFFLINE_AFTER_MS and not left', () => {
    const p = player('a', 0, { lastSeenAt: 1000 });
    expect(isOnline(p, 1000 + OFFLINE_AFTER_MS)).toBe(true);
    expect(isOnline(p, 1001 + OFFLINE_AFTER_MS)).toBe(false);
    expect(isOnline({ ...p, leftAt: 1000 }, 1000)).toBe(false);
  });
});

describe('Start', () => {
  it('Start only by host and only in lobby', () => {
    expect(err(apply(lobby(), { type: 'Start', playerId: 'a' }, 2000))).toBe('NOT_HOST');
    expect(
      err(apply(lobby({ phase: 'results' }), { type: 'Start', playerId: 'h' }, 2000)),
    ).toBe('WRONG_PHASE');

    const start = lobby({ version: 3 });
    const r = ok(apply(start, { type: 'Start', playerId: 'h' }, 2000));
    expect(r.state).toMatchObject({
      phase: 'countdown',
      roundIdx: 0,
      phaseEndsAt: 2000 + COUNTDOWN_MS,
      version: 4,
    });
    expect(r.effects).toEqual([
      { type: 'CreateRounds', gameNo: 1, count: 10, theme: THEME },
    ]);
    // input not mutated
    expect(start.phase).toBe('lobby');
    expect(start.version).toBe(3);
  });

  it('Start without a theme is THEME_REQUIRED', () => {
    expect(err(apply(lobby({ theme: null }), { type: 'Start', playerId: 'h' }, 2000))).toBe(
      'THEME_REQUIRED',
    );
  });
});

describe('Tick', () => {
  it('Tick before phaseEndsAt is a no-op that does not bump version', () => {
    const s = lobby({ phase: 'countdown', phaseEndsAt: 5000, version: 4 });
    const r = ok(apply(s, { type: 'Tick' }, 4999));
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);

    const l = lobby({ version: 2 });
    const r2 = ok(apply(l, { type: 'Tick' }, 2000));
    expect(r2.state).toBe(l);
    expect(r2.effects).toEqual([]);
  });

  it('Tick after phaseEndsAt moves countdown→presenting→question→reveal→presenting(next)→…→results', () => {
    let s = lobby({ settings: { ...lobby().settings, questionCount: 5 } });
    let now = 1000;
    s = ok(apply(s, { type: 'Start', playerId: 'h' }, now)).state;
    expect(s.phase).toBe('countdown');

    const seen: string[] = [];
    let guard = 0;
    while (s.phase !== 'results' && guard++ < 100) {
      // Tick exactly at the deadline (now >= phaseEndsAt transitions).
      now = s.phaseEndsAt!;
      const before = s.version;
      const r = ok(apply(s, { type: 'Tick' }, now));
      expect(r.state.version).toBe(before + 1);
      s = r.state;
      seen.push(`${s.phase}${s.phase === 'results' ? '' : `(${s.roundIdx})`}`);

      if (s.phase === 'presenting') expect(s.phaseEndsAt).toBe(now + PRESENT_MS);
      if (s.phase === 'question') {
        expect(s.phaseEndsAt).toBe(now + DEFAULT_TIME_LIMIT_MS);
        expect(s.currentRound).toEqual({ idx: s.roundIdx, answeredPlayerIds: [] });
        expect(r.effects).toEqual([
          {
            type: 'StartRound',
            gameNo: 1,
            idx: s.roundIdx,
            startedAt: now,
            deadlineAt: now + DEFAULT_TIME_LIMIT_MS,
          },
        ]);
      }
      if (s.phase === 'reveal') expect(s.phaseEndsAt).toBe(now + REVEAL_MS);
    }

    const expected = ['presenting(0)'];
    for (let i = 0; i < 5; i++) {
      expected.push(`question(${i})`, `reveal(${i})`);
      expected.push(i < 4 ? `presenting(${i + 1})` : 'results');
    }
    expect(seen).toEqual(expected);
    expect(s.phaseEndsAt).toBeNull();
    expect(s.currentRound).toBeUndefined();
    expect(s.roundIdx).toBe(4);
  });

  it('results phase follows the last reveal', () => {
    const s = lobby({
      phase: 'reveal',
      roundIdx: 9,
      phaseEndsAt: 5000,
      version: 40,
      currentRound: { idx: 9, answeredPlayerIds: ['a'] },
    });
    const r = ok(apply(s, { type: 'Tick' }, 5000));
    expect(r.state).toMatchObject({ phase: 'results', phaseEndsAt: null, version: 41 });
    expect(r.state.currentRound).toBeUndefined();
    expect(r.effects).toEqual([]);
  });

  it('reveal of a non-last round moves to presenting of the next round and clears currentRound', () => {
    const s = lobby({
      phase: 'reveal',
      roundIdx: 2,
      phaseEndsAt: 5000,
      currentRound: { idx: 2, answeredPlayerIds: ['a'] },
    });
    const r = ok(apply(s, { type: 'Tick' }, 6000));
    expect(r.state).toMatchObject({ phase: 'presenting', roundIdx: 3, phaseEndsAt: 6000 + PRESENT_MS });
    expect(r.state.currentRound).toBeUndefined();
  });

  it('two Ticks with the same expected version produce one transition', () => {
    const s = lobby({ phase: 'countdown', phaseEndsAt: 5000, version: 4 });
    const r1 = ok(apply(s, { type: 'Tick' }, 5100));
    const r2 = ok(apply(s, { type: 'Tick' }, 5100));
    expect(r1.state).toEqual(r2.state);
    expect(r1.state.version).toBe(5);
    expect(r2.state.version).toBe(5);
    expect(r1.state.phase).toBe('presenting');
    expect(r1.state.roundIdx).toBe(0);

    // The second caller, after reloading the new state, ticks before the new deadline: no-op.
    const again = ok(apply(r1.state, { type: 'Tick' }, 5200));
    expect(again.state).toBe(r1.state);
    expect(again.effects).toEqual([]);
  });

  it('Tick moves question → reveal and keeps currentRound', () => {
    const s = inQuestion(0, ['a']);
    const r = ok(apply(s, { type: 'Tick' }, 20000));
    expect(r.state).toMatchObject({
      phase: 'reveal',
      roundIdx: 0,
      phaseEndsAt: 20000 + REVEAL_MS,
      currentRound: { idx: 0, answeredPlayerIds: ['a'] },
    });
  });
});

describe('Answer', () => {
  const answer = (playerId: string, isCorrect = true): Command => ({
    type: 'Answer',
    playerId,
    answerId: 'c1',
    isCorrect,
  });

  it('Answer accepted only in question phase and before deadline', () => {
    expect(err(apply(lobby({ phase: 'presenting', phaseEndsAt: 9000 }), answer('a'), 8000))).toBe(
      'WRONG_PHASE',
    );
    expect(err(apply(lobby({ phase: 'reveal', phaseEndsAt: 9000 }), answer('a'), 8000))).toBe(
      'WRONG_PHASE',
    );
    expect(err(apply(inQuestion(), answer('a'), 20001))).toBe('TOO_LATE');

    const s = inQuestion();
    const r = ok(apply(s, answer('a'), 20000)); // exactly at the deadline is still accepted
    expect(r.state.version).toBe(8);
    expect(r.state.currentRound).toEqual({ idx: 0, answeredPlayerIds: ['a'] });
  });

  it('second Answer by the same player is ALREADY_ANSWERED', () => {
    const r = ok(apply(inQuestion(), answer('a'), 10000));
    expect(err(apply(r.state, answer('a'), 11000))).toBe('ALREADY_ANSWERED');
  });

  it('Answer from a player whose joined_round is later is NOT_IN_ROUND', () => {
    const s = inQuestion(2);
    const late = { ...s, players: [...s.players, player('c', 900, { joinedRound: 3 })] };
    expect(err(apply(late, answer('c'), 10000))).toBe('NOT_IN_ROUND');
    expect(err(apply(s, answer('stranger'), 10000))).toBe('NOT_IN_ROUND');
    const left = {
      ...s,
      players: s.players.map((p) => (p.id === 'b' ? { ...p, leftAt: 900 } : p)),
    };
    expect(err(apply(left, answer('b'), 10000))).toBe('NOT_IN_ROUND');
    // joinedRound equal to the current round may answer
    const now = { ...s, players: [...s.players, player('d', 900, { joinedRound: 2 })] };
    expect(ok(apply(now, answer('d'), 10000)).state.version).toBe(8);
  });

  it('records points matching pointsFor and adds them to the player score', () => {
    const s = inQuestion(3);
    const withScore = {
      ...s,
      players: s.players.map((p) => (p.id === 'a' ? { ...p, score: 1000 } : p)),
    };
    const r = ok(apply(withScore, answer('a'), 14000)); // 6000 ms remaining
    const points = pointsFor(4, true, 6000, DEFAULT_TIME_LIMIT_MS);
    expect(points).toBeGreaterThan(0);
    expect(r.effects).toEqual([
      {
        type: 'RecordAnswer',
        gameNo: 1,
        idx: 3,
        playerId: 'a',
        answerId: 'c1',
        answeredAt: 14000,
        points,
      },
      { type: 'AddScore', playerId: 'a', points },
    ]);
    expect(r.state.players.find((p) => p.id === 'a')!.score).toBe(1000 + points);

    const wrong = ok(apply(withScore, answer('b', false), 14000));
    expect(wrong.effects).toContainEqual({ type: 'AddScore', playerId: 'b', points: 0 });
    expect(wrong.state.players.find((p) => p.id === 'b')!.score).toBe(0);
    expect(wrong.state.currentRound!.answeredPlayerIds).toEqual(['b']);
  });
});

describe('Join', () => {
  const full = (): RoomState =>
    lobby({
      players: Array.from({ length: MAX_PLAYERS }, (_, i) =>
        player(i === 0 ? 'h' : `p${i}`, i * 10, { lastSeenAt: 1000 }),
      ),
    });

  it('Join rejects the 11th player with ROOM_FULL', () => {
    expect(err(apply(full(), { type: 'Join', playerId: 'eleven' }, 2000))).toBe('ROOM_FULL');
  });

  it('players who left do not count toward capacity', () => {
    const s = full();
    const oneLeft = {
      ...s,
      players: s.players.map((p) => (p.id === 'p5' ? { ...p, leftAt: 1500 } : p)),
    };
    const r = ok(apply(oneLeft, { type: 'Join', playerId: 'eleven' }, 2000));
    expect(r.state.players).toHaveLength(MAX_PLAYERS + 1);
    expect(r.state.version).toBe(oneLeft.version + 1);
  });

  it('a new player in lobby joins with joinedRound 0 and score 0', () => {
    const s = lobby({ version: 2 });
    const r = ok(apply(s, { type: 'Join', playerId: 'c' }, 3000));
    expect(r.state.version).toBe(3);
    expect(r.state.players.at(-1)).toEqual(player('c', 3000));
    expect(r.effects).toEqual([]);
  });

  it('joining again while still in the room is an idempotent no-op', () => {
    const s = lobby({ version: 2 });
    const r = ok(apply(s, { type: 'Join', playerId: 'a' }, 3000));
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);
  });

  it('Join during a game with lateJoin=false is LATE_JOIN_CLOSED', () => {
    const settings = { ...lobby().settings, lateJoin: false };
    for (const phase of ['countdown', 'presenting', 'question', 'reveal'] as const) {
      const s = lobby({ phase, settings, phaseEndsAt: 9000, roundIdx: 1 });
      expect(err(apply(s, { type: 'Join', playerId: 'c' }, 3000))).toBe('LATE_JOIN_CLOSED');
    }
    // lobby/results are not "during a game"
    for (const phase of ['lobby', 'results'] as const) {
      const s = lobby({ phase, settings });
      expect(ok(apply(s, { type: 'Join', playerId: 'c' }, 3000)).state.players.at(-1)).toEqual(
        player('c', 3000),
      );
    }
  });

  it('Join during a game with lateJoin=true sets joined_round to current+1 and score 0', () => {
    for (const phase of ['presenting', 'question', 'reveal'] as const) {
      const s = lobby({ phase, roundIdx: 4, phaseEndsAt: 9000 });
      const r = ok(apply(s, { type: 'Join', playerId: 'c' }, 3000));
      expect(r.state.players.at(-1)).toEqual(player('c', 3000, { joinedRound: 5, score: 0 }));
    }
  });

  it('late join during countdown plays from round 0', () => {
    const s = lobby({ phase: 'countdown', phaseEndsAt: 9000 });
    const r = ok(apply(s, { type: 'Join', playerId: 'c' }, 3000));
    expect(r.state.players.at(-1)).toEqual(player('c', 3000, { joinedRound: 0 }));
  });

  it('a returning player is restored with score and joinedRound kept, even with lateJoin=false', () => {
    const settings = { ...lobby().settings, lateJoin: false };
    const s = lobby({ phase: 'question', roundIdx: 6, phaseEndsAt: 9000, settings });
    const gone = {
      ...s,
      players: s.players.map((p) =>
        p.id === 'a' ? { ...p, leftAt: 1500, score: 2400, joinedRound: 2 } : p,
      ),
    };
    const r = ok(apply(gone, { type: 'Join', playerId: 'a' }, 3000));
    expect(r.state.players.find((p) => p.id === 'a')).toEqual(
      player('a', 100, { leftAt: null, score: 2400, joinedRound: 2, lastSeenAt: 3000 }),
    );
    expect(r.state.players).toHaveLength(3);
    expect(r.state.version).toBe(gone.version + 1);
  });

  it('a returning player is still subject to ROOM_FULL', () => {
    const s = full();
    const withLeft = { ...s, players: [...s.players, player('back', 5, { leftAt: 900 })] };
    expect(err(apply(withLeft, { type: 'Join', playerId: 'back' }, 2000))).toBe('ROOM_FULL');
  });
});

describe('Join and host', () => {
  it('a newcomer becomes host when the host left and nobody else is online', () => {
    const later = 1000 + OFFLINE_AFTER_MS + 1000;
    const s = lobby({ players: lobby().players.map((p) => (p.id === 'h' ? { ...p, leftAt: 1500 } : p)) });
    const r = ok(apply(s, { type: 'Join', playerId: 'n' }, later));
    expect(r.state.hostId).toBe('n');
  });

  it('a returning player becomes host in a room nobody is online in', () => {
    const later = 1000 + OFFLINE_AFTER_MS + 1000;
    const s = lobby({
      players: [...lobby().players.map((p) => (p.id === 'h' ? { ...p, leftAt: 1500 } : p)), player('r', 50, { leftAt: 900 })],
    });
    const r = ok(apply(s, { type: 'Join', playerId: 'r' }, later));
    expect(r.state.hostId).toBe('r');
  });

  it('joining does not take host from an online host', () => {
    const r = ok(apply(lobby(), { type: 'Join', playerId: 'n' }, 2000));
    expect(r.state.hostId).toBe('h');
  });
});

describe('Leave and host transfer', () => {
  it('Leave marks the player as left', () => {
    const s = lobby({ version: 2 });
    const r = ok(apply(s, { type: 'Leave', playerId: 'b' }, 3000));
    expect(r.state.players.find((p) => p.id === 'b')!.leftAt).toBe(3000);
    expect(r.state.hostId).toBe('h');
    expect(r.state.version).toBe(3);
  });

  it('Leave of the host transfers the host immediately to the earliest-joined online player', () => {
    const s = lobby({ version: 2 });
    const r = ok(apply(s, { type: 'Leave', playerId: 'h' }, 3000));
    expect(r.state.hostId).toBe('a');
    expect(r.state.version).toBe(3);
  });

  it('Leave of the host with nobody else online keeps the host', () => {
    const s = lobby({ players: [player('h', 0, { lastSeenAt: 1000 })] });
    const r = ok(apply(s, { type: 'Leave', playerId: 'h' }, 3000));
    expect(r.state.hostId).toBe('h');
    expect(r.state.players[0].leftAt).toBe(3000);
  });

  it('when the host is offline longer than OFFLINE_AFTER_MS the host passes to the earliest-joined online player', () => {
    const s = lobby({
      version: 5,
      players: [
        player('h', 0, { lastSeenAt: 1000 }),
        player('a', 100, { lastSeenAt: 1000 }), // also offline
        player('b', 200, { lastSeenAt: 40000 }),
        player('c', 300, { lastSeenAt: 40000 }),
      ],
    });
    const now = 1000 + OFFLINE_AFTER_MS + 1;
    // Tick in lobby (phaseEndsAt null) still runs the host check
    const r = ok(apply(s, { type: 'Tick' }, now));
    expect(r.state.hostId).toBe('b');
    expect(r.state.version).toBe(6);
    expect(r.state.phase).toBe('lobby');

    // exactly at the boundary the host is still online: no change
    const still = ok(apply(s, { type: 'Tick' }, 1000 + OFFLINE_AFTER_MS));
    expect(still.state).toBe(s);
  });

  it('ties on joinedAt are broken by id', () => {
    const s = lobby({
      players: [
        player('h', 0, { lastSeenAt: 0 }),
        player('z', 100, { lastSeenAt: 90000 }),
        player('y', 100, { lastSeenAt: 90000 }),
      ],
    });
    expect(ok(apply(s, { type: 'Tick' }, 90000)).state.hostId).toBe('y');
  });

  it('host transfer and phase transition in one Tick bump version once', () => {
    const s = lobby({
      phase: 'countdown',
      phaseEndsAt: 5000,
      version: 9,
      players: [player('h', 0, { lastSeenAt: 0 }), player('a', 100, { lastSeenAt: 60000 })],
    });
    const r = ok(apply(s, { type: 'Tick' }, 60000));
    expect(r.state).toMatchObject({ phase: 'presenting', hostId: 'a', version: 10 });
  });

  it('host transfer does not happen when nobody is online', () => {
    const s = lobby({ players: [player('h', 0, { lastSeenAt: 0 }), player('a', 100, { lastSeenAt: 0 })] });
    const r = ok(apply(s, { type: 'Tick' }, 100000));
    expect(r.state).toBe(s);
  });
});

describe('Heartbeat', () => {
  it('an online player heartbeat updates lastSeenAt without bumping version', () => {
    const s = lobby({ version: 4 });
    const r = ok(apply(s, { type: 'Heartbeat', playerId: 'a' }, 16000));
    expect(r.state.version).toBe(4);
    expect(r.state.players.find((p) => p.id === 'a')!.lastSeenAt).toBe(16000);
    expect(r.effects).toEqual([{ type: 'TouchPlayer', playerId: 'a', lastSeenAt: 16000 }]);
    expect(s.players.find((p) => p.id === 'a')!.lastSeenAt).toBe(1000); // input untouched
  });

  it('a heartbeat from a player who was offline bumps version', () => {
    const s = lobby({ version: 4 });
    const now = 1000 + OFFLINE_AFTER_MS + 1;
    const r = ok(apply(s, { type: 'Heartbeat', playerId: 'h' }, now));
    expect(r.state.version).toBe(5);
    expect(r.state.hostId).toBe('h');
    expect(r.effects).toEqual([{ type: 'TouchPlayer', playerId: 'h', lastSeenAt: now }]);
  });

  it('a heartbeat that causes a host transfer bumps version', () => {
    const s = lobby({
      version: 4,
      players: [player('h', 0, { lastSeenAt: 0 }), player('a', 100, { lastSeenAt: 40000 })],
    });
    const r = ok(apply(s, { type: 'Heartbeat', playerId: 'a' }, 50000));
    expect(r.state.hostId).toBe('a');
    expect(r.state.version).toBe(5);
  });

  it('a heartbeat from someone not in the room is a no-op', () => {
    const s = lobby();
    const gone = { ...s, players: s.players.map((p) => (p.id === 'b' ? { ...p, leftAt: 900 } : p)) };
    expect(ok(apply(gone, { type: 'Heartbeat', playerId: 'b' }, 2000)).state).toBe(gone);
    expect(ok(apply(gone, { type: 'Heartbeat', playerId: 'x' }, 2000)).state).toBe(gone);
  });
});

describe('UpdateSettings / UpdateTheme', () => {
  it('UpdateSettings rejects values outside the allowed options', () => {
    const s = lobby();
    const bad: Array<Record<string, unknown>> = [
      { questionCount: 7 },
      { questionCount: '10' },
      { timeLimitMs: 12000 },
      { timeLimitMs: 5000 }, // dropped option
      { questionCount: 8 }, // dropped option
      { timeLimitMs: 25000 },
      { showLiveAnswers: 'yes' },
      { lateJoin: 1 },
      { somethingElse: true },
    ];
    for (const patch of bad) {
      const cmd = { type: 'UpdateSettings', playerId: 'h', patch } as unknown as Command;
      expect(err(apply(s, cmd, 2000))).toBe('INVALID_SETTINGS');
    }
  });

  it('UpdateSettings applies a valid patch (host, lobby only)', () => {
    const s = lobby({ version: 2 });
    const patch = { questionCount: 20, timeLimitMs: 20000, lateJoin: false };
    expect(err(apply(s, { type: 'UpdateSettings', playerId: 'a', patch }, 2000))).toBe('NOT_HOST');
    expect(
      err(apply(lobby({ phase: 'question' }), { type: 'UpdateSettings', playerId: 'h', patch }, 2000)),
    ).toBe('WRONG_PHASE');
    const r = ok(apply(s, { type: 'UpdateSettings', playerId: 'h', patch }, 2000));
    expect(r.state.settings).toEqual({
      questionCount: 20,
      timeLimitMs: 20000,
      showLiveAnswers: true,
      lateJoin: false,
    });
    expect(r.state.version).toBe(3);
    expect(r.effects).toEqual([]);
  });

  it('UpdateTheme sets the theme (host, lobby only)', () => {
    const s = lobby({ theme: null, version: 2 });
    const theme = { type: 'decade', key: '2010s' } as const;
    expect(err(apply(s, { type: 'UpdateTheme', playerId: 'b', theme }, 2000))).toBe('NOT_HOST');
    expect(
      err(apply(lobby({ phase: 'results' }), { type: 'UpdateTheme', playerId: 'h', theme }, 2000)),
    ).toBe('WRONG_PHASE');
    const r = ok(apply(s, { type: 'UpdateTheme', playerId: 'h', theme }, 2000));
    expect(r.state.theme).toEqual(theme);
    expect(r.state.version).toBe(3);
  });
});

describe('UpdateTheme no-op', () => {
  it('re-picking the current theme does not bump the version', () => {
    const s = lobby({ version: 4 });
    const r = ok(apply(s, { type: 'UpdateTheme', playerId: 'h', theme: { ...THEME } }, 2000));
    expect(r.state.version).toBe(4);
  });
});

describe('Rematch', () => {
  it('Rematch from results returns to lobby, increments gameNo and resets scores', () => {
    const s = lobby({
      phase: 'results',
      roundIdx: 9,
      gameNo: 2,
      version: 50,
      players: [
        player('h', 0, { score: 5000, lastSeenAt: 1000 }),
        player('a', 100, { score: 3000, joinedRound: 4, lastSeenAt: 1000 }),
        player('b', 200, { score: 100, leftAt: 900 }),
      ],
    });
    expect(err(apply(s, { type: 'Rematch', playerId: 'a' }, 2000))).toBe('NOT_HOST');
    expect(err(apply({ ...s, phase: 'reveal' }, { type: 'Rematch', playerId: 'h' }, 2000))).toBe(
      'WRONG_PHASE',
    );

    const r = ok(apply(s, { type: 'Rematch', playerId: 'h' }, 2000));
    expect(r.state).toMatchObject({
      phase: 'lobby',
      gameNo: 3,
      roundIdx: 0,
      phaseEndsAt: null,
      version: 51,
      theme: THEME,
    });
    expect(r.state.currentRound).toBeUndefined();
    expect(r.state.players.map((p) => [p.id, p.score, p.joinedRound])).toEqual([
      ['h', 0, 0],
      ['a', 0, 0],
      ['b', 0, 0],
    ]);
    expect(r.effects).toEqual([{ type: 'ResetScores', gameNo: 3 }]);
  });
});
