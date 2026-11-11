/**
 * Per-viewer room snapshot: the ONLY room data that leaves the server. Pure (no I/O).
 *
 * Anti-leak rules (Review Focus 1):
 *   - `round.reveal` (correctAnswerId, track title/artist/cover, top 3) only in phase `reveal`.
 *   - `round.choices` only in question/reveal, and only for the current round.
 *   - Before reveal the viewer's own answer carries no points/correctness, and every player's
 *     score excludes points earned in the current round (a score jump would reveal correctness).
 *     In-game scores are derived from `answers` (revealed rounds only), never from
 *     `player.score`, so a race between the two reads cannot show a partial score change.
 *   - `answers` must hold every answer of the current game (the service passes them all).
 *   - `history` only covers rounds that have already been revealed.
 */
import type { QuestionType, ThemeRef } from './round-builder';
import { pointsOnOffer } from './scoring';
import { isOnline, type Phase, type Player, type RoomSettings, type RoomState } from './state-machine';

// ----------------------------------------------------------------------------- output types

export interface SnapshotPlayer {
  id: string;
  nickname: string;
  avatarSeed: string;
  /**
   * Points from revealed rounds of this game (from the answers read): in presenting/question it
   * excludes the current round. lobby/countdown: the stored score (0 at the start of a game).
   */
  score: number;
  online: boolean;
  isHost: boolean;
  /** 0-based index of the first round this player may answer. */
  joinedRound: number;
  /** Answered the current round (question/reveal only; false otherwise). */
  hasAnswered: boolean;
}

export interface SnapshotChoice {
  answerId: string;
  label: string;
}

export interface SnapshotTrack {
  title: string;
  artist: string;
  coverUrl: string | null;
}

export interface SnapshotTopEntry {
  playerId: string;
  nickname: string;
  points: number;
}

export interface SnapshotReveal {
  correctAnswerId: string;
  track: SnapshotTrack;
  /** Up to 3 entries with points > 0: points desc, then answered earlier first. */
  top3: SnapshotTopEntry[];
}

export interface SnapshotMyAnswer {
  answerId: string;
  /** null until reveal. */
  points: number | null;
  /** null until reveal. */
  correct: boolean | null;
}

export interface SnapshotRound {
  /** 0-based. */
  idx: number;
  /** 1-based, for display ("Vòng n/N"). */
  roundNumber: number;
  questionType: QuestionType;
  pointsOnOffer: { base: number; maxBonus: number };
  /** Preview clip of this round (presenting/question/reveal). */
  audioUrl: string | null;
  /** Preview clip of the next round, for preloading; null on the last round. */
  nextAudioUrl: string | null;
  /** Viewer is an active player whose joinedRound <= idx (late joiners spectate). */
  canAnswer: boolean;
  /** question/reveal only; null in presenting. */
  choices: SnapshotChoice[] | null;
  myAnswer: SnapshotMyAnswer | null;
  answeredCount: number;
  /** answerId -> integer percent of this round's answers; reveal only (settings.showLiveAnswers is ignored). */
  livePercentages: Record<string, number> | null;
  /** Phase `reveal` only. */
  reveal: SnapshotReveal | null;
}

export interface SnapshotHistoryEntry {
  idx: number;
  roundNumber: number;
  questionType: QuestionType;
  track: SnapshotTrack;
  correctLabel: string;
  myAnswerId: string | null;
  myPoints: number;
  correct: boolean;
}

export interface RoomSnapshot {
  /** Server time when the snapshot was built; clients derive their clock offset from it. */
  serverNowMs: number;
  code: string;
  version: number;
  phase: Phase;
  /** Epoch ms of the current phase deadline; null in lobby/results. */
  phaseEndsAt: number | null;
  /** 0-based current round index. */
  roundIdx: number;
  questionCount: number;
  gameNo: number;
  hostId: string;
  viewerId: string;
  isHost: boolean;
  /** Viewer is in the room (joined and not left). */
  isMember: boolean;
  settings: RoomSettings;
  theme: (ThemeRef & { label: string }) | null;
  /** Active (not left) players, score desc, then joinedAt. */
  players: SnapshotPlayer[];
  /** presenting/question/reveal only. */
  round: SnapshotRound | null;
  /** Revealed rounds of the current game, idx asc. */
  history: SnapshotHistoryEntry[];
}

// ----------------------------------------------------------------------------- input types

export interface RoundRecord {
  idx: number;
  questionType: QuestionType;
  choices: SnapshotChoice[];
  correctAnswerId: string;
  track: SnapshotTrack & { previewUrl: string };
}

export interface AnswerRecord {
  idx: number;
  playerId: string;
  answerId: string;
  answeredAt: number;
  points: number;
}

export interface ProfileInfo {
  nickname: string;
  avatarSeed: string;
}

export interface SnapshotContext {
  code: string;
  profiles: Record<string, ProfileInfo>;
  /** Display label of `state.theme`; falls back to the key. */
  themeLabel?: string | null;
}

// ----------------------------------------------------------------------------- build

const ROUND_PHASES: Phase[] = ['presenting', 'question', 'reveal'];

/** Has round `idx` been revealed in this state? */
function isRevealed(state: RoomState, idx: number): boolean {
  switch (state.phase) {
    case 'presenting':
    case 'question':
      return idx < state.roundIdx;
    case 'reveal':
    case 'results':
      return idx <= state.roundIdx;
    default:
      return false;
  }
}

function trackOf(r: RoundRecord): SnapshotTrack {
  return { title: r.track.title, artist: r.track.artist, coverUrl: r.track.coverUrl };
}

export function buildSnapshot(
  state: RoomState,
  rounds: RoundRecord[],
  answers: AnswerRecord[],
  viewerId: string,
  nowMs: number,
  ctx: SnapshotContext,
): RoomSnapshot {
  const roundByIdx = new Map(rounds.map((r) => [r.idx, r]));
  const viewer = state.players.find((p) => p.id === viewerId && p.leftAt === null);
  const inRound = ROUND_PHASES.includes(state.phase);
  const answersNow = inRound ? answers.filter((a) => a.idx === state.roundIdx) : [];
  const answering = state.phase === 'question' || state.phase === 'reveal';
  const nickname = (id: string) => ctx.profiles[id]?.nickname ?? '';

  const answeredIds = new Set(answering ? answersNow.map((a) => a.playerId) : []);

  // Displayed scores. Points only ever come from recorded answers (AddScore with RecordAnswer;
  // reset to 0 per game), so once a game has started a score equals the sum of that player's
  // answer points in this game. Deriving it from the `answers` read, counting revealed rounds
  // only, keeps scores consistent with hasAnswered / livePercentages / top3 / history: they all
  // come from that one read. `player.score` comes from an earlier read and may disagree with
  // `answers` if an answer commits in between; using it with the current-round points subtracted
  // made a correct answer show up as a score drop (the race leak).
  const fromAnswers = inRound || state.phase === 'results';
  const revealedPoints = new Map<string, number>();
  if (fromAnswers) {
    for (const a of answers) {
      if (isRevealed(state, a.idx)) revealedPoints.set(a.playerId, (revealedPoints.get(a.playerId) ?? 0) + a.points);
    }
  }
  const shownScore = (p: Player) => (fromAnswers ? (revealedPoints.get(p.id) ?? 0) : p.score);
  const players: SnapshotPlayer[] = state.players
    .filter((p) => p.leftAt === null)
    .sort((a, b) => shownScore(b) - shownScore(a) || a.joinedAt - b.joinedAt)
    .map((p) => ({
      id: p.id,
      nickname: nickname(p.id),
      avatarSeed: ctx.profiles[p.id]?.avatarSeed ?? p.id,
      score: shownScore(p),
      online: isOnline(p, nowMs),
      isHost: p.id === state.hostId,
      joinedRound: p.joinedRound,
      hasAnswered: answeredIds.has(p.id),
    }));

  let round: SnapshotRound | null = null;
  const current = roundByIdx.get(state.roundIdx);
  if (inRound && current) {
    const revealed = state.phase === 'reveal';
    const mine = viewer ? answersNow.find((a) => a.playerId === viewer.id) : undefined;
    let livePercentages: Record<string, number> | null = null;
    // Shown on the reveal only: percentages while answering would steer late answerers.
    if (revealed) {
      livePercentages = {};
      for (const c of current.choices) {
        const n = answersNow.filter((a) => a.answerId === c.answerId).length;
        livePercentages[c.answerId] = answersNow.length ? Math.round((n * 100) / answersNow.length) : 0;
      }
    }
    round = {
      idx: current.idx,
      roundNumber: current.idx + 1,
      questionType: current.questionType,
      pointsOnOffer: pointsOnOffer(current.idx + 1),
      audioUrl: current.track.previewUrl,
      nextAudioUrl: roundByIdx.get(current.idx + 1)?.track.previewUrl ?? null,
      canAnswer: !!viewer && viewer.joinedRound <= current.idx,
      choices: answering ? current.choices.map((c) => ({ answerId: c.answerId, label: c.label })) : null,
      myAnswer: mine
        ? {
            answerId: mine.answerId,
            points: revealed ? mine.points : null,
            correct: revealed ? mine.answerId === current.correctAnswerId : null,
          }
        : null,
      answeredCount: answering ? answersNow.length : 0,
      livePercentages,
      reveal: revealed
        ? {
            correctAnswerId: current.correctAnswerId,
            track: trackOf(current),
            top3: answersNow
              .filter((a) => a.points > 0)
              .sort((a, b) => b.points - a.points || a.answeredAt - b.answeredAt)
              .slice(0, 3)
              .map((a) => ({ playerId: a.playerId, nickname: nickname(a.playerId), points: a.points })),
          }
        : null,
    };
  }

  const history: SnapshotHistoryEntry[] = rounds
    .filter((r) => isRevealed(state, r.idx))
    .sort((a, b) => a.idx - b.idx)
    .map((r) => {
      const mine = answers.find((a) => a.idx === r.idx && a.playerId === viewerId);
      return {
        idx: r.idx,
        roundNumber: r.idx + 1,
        questionType: r.questionType,
        track: trackOf(r),
        correctLabel: r.choices.find((c) => c.answerId === r.correctAnswerId)?.label ?? '',
        myAnswerId: mine?.answerId ?? null,
        myPoints: mine?.points ?? 0,
        correct: !!mine && mine.answerId === r.correctAnswerId,
      };
    });

  return {
    serverNowMs: nowMs,
    code: ctx.code,
    version: state.version,
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
    roundIdx: state.roundIdx,
    questionCount: state.settings.questionCount,
    gameNo: state.gameNo,
    hostId: state.hostId,
    viewerId,
    isHost: viewerId === state.hostId,
    isMember: !!viewer,
    settings: { ...state.settings },
    theme: state.theme
      ? { type: state.theme.type, key: state.theme.key, label: ctx.themeLabel || state.theme.key }
      : null,
    players,
    round,
    history,
  };
}
