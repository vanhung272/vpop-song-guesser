import { describe, expect, it } from 'vitest';
import { normalizeVi } from '@/lib/text/normalize-vi';
import {
  buildRounds,
  mulberry32,
  ThemeNotPlayableError,
  type Track,
} from './round-builder';

function makeTrack(i: number, artistIdx = i, title = `Bài hát ${i}`): Track {
  const artist = `Ca sĩ ${artistIdx}`;
  return {
    id: `t${i}`,
    title,
    titleNorm: normalizeVi(title),
    artist,
    artistNorm: normalizeVi(artist),
    artistKeys: [normalizeVi(artist)],
    previewUrl: `https://example.com/${i}.m4a`,
    coverUrl: null,
  };
}

const tracks = (n: number, artistCount = n) =>
  Array.from({ length: n }, (_, i) => makeTrack(i, i % artistCount));

const genre = { type: 'genre', key: 'pop' } as const;
const artistTheme = { type: 'artist', key: 'son tung m-tp' } as const;

describe('buildRounds', () => {
  it('returns count rounds with distinct tracks', () => {
    const rounds = buildRounds(tracks(20), genre, 10, mulberry32(1));
    expect(rounds).toHaveLength(10);
    expect(new Set(rounds.map((r) => r.trackId)).size).toBe(10);
  });

  it('each round has 4 distinct labels and the correct answer among them', () => {
    const ts = tracks(20);
    const rounds = buildRounds(ts, genre, 10, mulberry32(2));
    for (const r of rounds) {
      expect(r.choices).toHaveLength(4);
      expect(new Set(r.choices.map((c) => c.label)).size).toBe(4);
      expect(new Set(r.choices.map((c) => c.answerId)).size).toBe(4);
      const correct = r.choices.find((c) => c.answerId === r.correctAnswerId);
      expect(correct).toBeDefined();
      const track = ts.find((t) => t.id === r.trackId)!;
      expect(correct!.label).toBe(
        r.questionType === 'title' ? track.title : track.artist,
      );
    }
  });

  it('no title-question distractor shares titleNorm with the correct track', () => {
    // many tracks share the same title as other tracks (different diacritics/case)
    const ts: Track[] = [];
    for (let i = 0; i < 16; i++) {
      const title = i % 2 === 0 ? `Mùa Hè ${i % 4}` : `mua he ${i % 4}`;
      ts.push(makeTrack(i, i, title));
    }
    // titleNorm groups: 4 distinct values
    const rounds = buildRounds(ts, artistTheme, 8, mulberry32(3));
    for (const r of rounds) {
      expect(r.questionType).toBe('title');
      const norms = r.choices.map((c) => normalizeVi(c.label));
      expect(new Set(norms).size).toBe(4);
    }
  });

  it('artist questions have 4 distinct artists', () => {
    const ts = tracks(24, 8);
    let artistRounds = 0;
    for (let seed = 0; seed < 20; seed++) {
      const rounds = buildRounds(ts, genre, 12, mulberry32(seed));
      for (const r of rounds.filter((x) => x.questionType === 'artist')) {
        artistRounds++;
        const norms = r.choices.map((c) => normalizeVi(c.label));
        expect(new Set(norms).size).toBe(4);
      }
    }
    expect(artistRounds).toBeGreaterThan(0);
  });

  it('falls back to title when fewer than 4 distinct artists exist', () => {
    const ts = tracks(12, 3);
    const rounds = buildRounds(ts, genre, 8, mulberry32(4));
    expect(rounds.every((r) => r.questionType === 'title')).toBe(true);
  });

  it('asks "Ai hát?" only about tracks by a curated artist (not covers of classics by anyone)', () => {
    // Half the pool has no curated artist (e.g. Tết classics sung by many); those are title-only.
    const ts = tracks(24, 24).map((t, i) => (i % 2 ? { ...t, artistKeys: [] } : t));
    let artistRounds = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (const r of buildRounds(ts, genre, 12, mulberry32(seed))) {
        if (r.questionType !== 'artist') continue;
        artistRounds++;
        expect(ts.find((t) => t.id === r.trackId)!.artistKeys.length).toBeGreaterThan(0);
      }
    }
    expect(artistRounds).toBeGreaterThan(0);
  });

  it('artist themes only produce title questions', () => {
    const ts = tracks(24, 8);
    for (let seed = 0; seed < 10; seed++) {
      const rounds = buildRounds(ts, artistTheme, 12, mulberry32(seed));
      expect(rounds.every((r) => r.questionType === 'title')).toBe(true);
    }
  });

  it('throws ThemeNotPlayableError when tracks < count', () => {
    expect(() => buildRounds(tracks(4), genre, 5, mulberry32(1))).toThrow(
      ThemeNotPlayableError,
    );
  });

  it('throws ThemeNotPlayableError when distinct titles cannot fill 4 choices', () => {
    const ts = Array.from({ length: 6 }, (_, i) => makeTrack(i, i, 'Cùng tên'));
    expect(() => buildRounds(ts, artistTheme, 5, mulberry32(1))).toThrow(
      ThemeNotPlayableError,
    );
  });

  it('is deterministic for a seeded rng', () => {
    const ts = tracks(24, 8);
    const shape = (seed: number) =>
      buildRounds(ts, genre, 10, mulberry32(seed)).map((r) => ({
        trackId: r.trackId,
        questionType: r.questionType,
        labels: r.choices.map((c) => c.label),
        correctIndex: r.choices.findIndex(
          (c) => c.answerId === r.correctAnswerId,
        ),
      }));
    expect(shape(42)).toEqual(shape(42));
    expect(shape(42)).not.toEqual(shape(43));
  });

  it('answerIds are not predictable from the answer', () => {
    const a = buildRounds(tracks(20), genre, 5, mulberry32(7));
    const b = buildRounds(tracks(20), genre, 5, mulberry32(7));
    expect(a[0].correctAnswerId).not.toBe(b[0].correctAnswerId);
  });

  it('varies the position of the correct answer', () => {
    const rounds = buildRounds(tracks(40), artistTheme, 15, mulberry32(9));
    const positions = new Set(
      rounds.map((r) => r.choices.findIndex((c) => c.answerId === r.correctAnswerId)),
    );
    expect(positions.size).toBeGreaterThan(1);
  });
});
