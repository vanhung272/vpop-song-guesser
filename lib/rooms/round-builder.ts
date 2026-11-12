import type { ThemeSummary } from '@/lib/themes/themes';
import { normalizeVi } from '@/lib/text/normalize-vi';
import { CHOICE_COUNT } from './config';

export interface Track {
  id: string;
  title: string;
  titleNorm: string;
  artist: string;
  artistNorm: string;
  artistKeys: string[];
  previewUrl: string;
  coverUrl: string | null;
}

export type ThemeRef = Pick<ThemeSummary, 'type' | 'key'>;
export type QuestionType = 'title' | 'artist';

export interface BuiltChoice {
  answerId: string;
  label: string;
}

export interface BuiltRound {
  trackId: string;
  questionType: QuestionType;
  choices: BuiltChoice[];
  correctAnswerId: string;
}

export type Rng = () => number;

export class ThemeNotPlayableError extends Error {
  constructor(message = 'Theme cannot supply enough distinct questions') {
    super(message);
    this.name = 'ThemeNotPlayableError';
  }
}

/** Small seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * What a player reads as "the same answer": letters and digits only, after normalizeVi (case,
 * diacritics, whitespace). "Jack - J97", "Jack- J97" and "jack -j97" all give "jackj97", so two
 * spellings of one credit or title never show up as two different choices.
 */
export function answerKey(label: string): string {
  return normalizeVi(label).replace(/[^\p{L}\p{N}]/gu, '');
}

/** Pick `need` labels from shuffled candidates with distinct, unused keys. */
function pickDistinct(
  candidates: readonly Track[],
  keyOf: (t: Track) => string,
  labelOf: (t: Track) => string,
  usedKey: string,
  need: number,
  rng: Rng,
): string[] | null {
  const used = new Set([usedKey]);
  const labels: string[] = [];
  for (const t of shuffle(candidates, rng)) {
    const key = keyOf(t);
    if (used.has(key)) continue;
    used.add(key);
    labels.push(labelOf(t));
    if (labels.length === need) return labels;
  }
  return null;
}

function assemble(
  track: Track,
  questionType: QuestionType,
  correctLabel: string,
  distractors: string[],
  rng: Rng,
): BuiltRound {
  const entries = shuffle(
    [
      { label: correctLabel, correct: true },
      ...distractors.map((label) => ({ label, correct: false })),
    ],
    rng,
  );
  const choices: BuiltChoice[] = [];
  let correctAnswerId = '';
  for (const e of entries) {
    const answerId = crypto.randomUUID();
    choices.push({ answerId, label: e.label });
    if (e.correct) correctAnswerId = answerId;
  }
  return { trackId: track.id, questionType, choices, correctAnswerId };
}

/**
 * Build `count` rounds from a theme's tracks. Distractors come from the same
 * tracks. Artist themes only get `title` questions; other themes pick
 * randomly, using `artist` ("Ai hát?") only for a track by a curated artist
 * (a classic covered by many singers has no single answer) and only when 4
 * distinct artists are available.
 */
export function buildRounds(
  tracks: Track[],
  theme: ThemeRef,
  count: number,
  rng: Rng,
): BuiltRound[] {
  const pool = [...new Map(tracks.map((t) => [t.id, t])).values()];
  if (pool.length < count || pool.length < CHOICE_COUNT) {
    throw new ThemeNotPlayableError();
  }
  const need = CHOICE_COUNT - 1;
  const picked = shuffle(pool, rng).slice(0, count);

  return picked.map((track) => {
    const others = pool.filter((t) => t.id !== track.id);
    let artistDistractors: string[] | null = null;
    if (theme.type !== 'artist' && track.artistKeys.length > 0 && rng() < 0.5) {
      artistDistractors = pickDistinct(
        others,
        (t) => answerKey(t.artist),
        (t) => t.artist,
        answerKey(track.artist),
        need,
        rng,
      );
    }
    if (artistDistractors) {
      return assemble(track, 'artist', track.artist, artistDistractors, rng);
    }
    const titleDistractors = pickDistinct(
      others,
      (t) => answerKey(t.title),
      (t) => t.title,
      answerKey(track.title),
      need,
      rng,
    );
    if (!titleDistractors) throw new ThemeNotPlayableError();
    return assemble(track, 'title', track.title, titleDistractors, rng);
  });
}
