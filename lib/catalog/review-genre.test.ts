import { describe, expect, it } from 'vitest';
import type { Artist } from './filter';
import { GENRE_LABELS } from './genre';
import { reclassifyReview, toReviewTrack, type ReviewFile } from './review';

const artists: Artist[] = [
  { key: 'den-vau', name: 'Đen Vâu', aliases: ['Đen'], genre: 'rap' },
  { key: 'quang-le', name: 'Quang Lê', genre: 'bolero' },
];

const track = (title: string, artist: string, genre: string | null, extra: object = {}) => ({
  include: true,
  itunesTrackId: 1,
  title,
  artist,
  genre,
  releaseYear: 2020,
  previewUrl: 'https://a/1.m4a',
  coverUrl: null,
  ...extra,
});

describe('genre in review files', () => {
  it('a fetched song is filed by the classifier and keeps its iTunes label', () => {
    const t = toReviewTrack(
      { trackId: 1, trackName: 'Lối Nhỏ', artistName: 'Đen', previewUrl: 'x', primaryGenreName: 'Worldwide' },
      true,
      artists,
      'den-vau',
    );
    expect(t).toMatchObject({ genre: GENRE_LABELS.rap, itunesGenre: 'Worldwide' });
  });

  it('reclassify files every entry from its iTunes label, remembering that label once', () => {
    const review: ReviewFile = {
      version: 1,
      artistKey: 'quang-le',
      note: '',
      kept: [track('Xin Đừng Lãng Quên', 'Quang Lê', 'Country'), track('Tết Này Con Về', 'Quang Lê', 'Nhạc Xuân & Tết')],
      dropped: [{ ...track('Bài Remix', 'Quang Lê', 'Dance'), include: false, reason: 'variant' }],
    };
    const once = reclassifyReview(review, artists);
    expect(once.kept.map((t) => [t.genre, t.itunesGenre])).toEqual([
      [GENRE_LABELS.bolero, 'Country'],
      ['Nhạc Xuân & Tết', null], // the Tết label was ours, not iTunes'
    ]);
    expect(once.dropped[0]).toMatchObject({ genre: GENRE_LABELS.bolero, itunesGenre: 'Dance' });
    // Idempotent: a second run reads the remembered iTunes label, not the genre it wrote.
    expect(reclassifyReview(once, artists)).toEqual(once);
  });

  it('a song also listed in a collection (e.g. a TV show) takes the collection genre', () => {
    const review: ReviewFile = {
      version: 1,
      artistKey: 'den-vau',
      note: '',
      kept: [track('Đan Bàn Tay', 'Châu Bùi & Đen', 'Pop', { itunesTrackId: 7 }), track('Lối Nhỏ', 'Đen', 'Pop', { itunesTrackId: 8 })],
      dropped: [],
    };
    const out = reclassifyReview(review, artists, new Map([[7, 'Em Xinh']]));
    expect(out.kept.map((t) => t.genre)).toEqual(['Em Xinh', GENRE_LABELS.rap]);
  });

  it('leaves collection files (hand-picked, no artist) as they are', () => {
    const review: ReviewFile = {
      version: 1,
      collection: 'tet-classics',
      note: '',
      kept: [track('Ly Rượu Mừng', 'Hợp Ca', 'Nhạc Xuân & Tết')],
      dropped: [],
    };
    expect(reclassifyReview(review, artists)).toEqual(review);
  });
});
