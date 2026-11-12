import { describe, expect, it } from 'vitest';
import type { Artist } from './filter';
import { GENRE_LABELS, classifyGenre } from './genre';
import { TET_GENRE } from './filter';

const artists: Artist[] = [
  { key: 'den-vau', name: 'Đen Vâu', aliases: ['Đen'], genre: 'rap' },
  { key: 'my-tam', name: 'Mỹ Tâm', genre: 'vpop' },
  { key: 'quang-le', name: 'Quang Lê', genre: 'bolero' },
  { key: 'hong-nhung', name: 'Hồng Nhung', genre: 'xua' },
  { key: 'ngot', name: 'Ngọt', genre: 'indie' },
  { key: 'no-genre', name: 'Ai Đó' },
];
const classify = (title: string, artist: string, itunesGenre: string | null = 'Pop', fileArtist?: string) =>
  classifyGenre({ title, artist, itunesGenre }, artists, fileArtist);

describe('classifyGenre', () => {
  it('Tết and spring songs go to the Tết genre, whoever sings them', () => {
    expect(classify('Tết Ơi Tết À', 'Đen', 'Hip-Hop/Rap')).toBe(TET_GENRE);
  });

  it('film songs go to Nhạc phim (OST)', () => {
    expect(classify('Người Lạ Ơi (OST Mắt Biếc)', 'Mỹ Tâm')).toBe(GENRE_LABELS.ost);
    expect(classify('Em Gái Mưa - Nhạc Phim', 'Mỹ Tâm')).toBe(GENRE_LABELS.ost);
  });

  it("otherwise uses the main genre of the first credited curated artist", () => {
    expect(classify('Bài Này Chill Phết', 'Đen & Mỹ Tâm')).toBe(GENRE_LABELS.rap);
    expect(classify('Bài Này Chill Phết', 'Mỹ Tâm & Đen')).toBe(GENRE_LABELS.vpop);
    expect(classify('Xin Đừng Lãng Quên', 'Ai Khác, Quang Lê')).toBe(GENRE_LABELS.bolero);
  });

  it('ignores the noisy iTunes labels (Worldwide, Asia, Country, K-Pop...)', () => {
    for (const label of ['Worldwide', 'Asia', 'Country', 'K-Pop', 'Adult Contemporary', null]) {
      expect(classify('Một Cõi Đi Về', 'Hồng Nhung', label)).toBe(GENRE_LABELS.xua);
    }
  });

  it('trusts a specific iTunes label for a modern artist, not for a traditional one', () => {
    expect(classify('Bài Mới', 'Mỹ Tâm', 'Hip-Hop/Rap')).toBe(GENRE_LABELS.rap);
    expect(classify('Bài Mới', 'Mỹ Tâm', 'R&B/Soul')).toBe(GENRE_LABELS.rnb);
    expect(classify('Bài Mới', 'Mỹ Tâm', 'Dance')).toBe(GENRE_LABELS.edm);
    expect(classify('Bài Mới', 'Mỹ Tâm', 'Indie Pop')).toBe(GENRE_LABELS.indie);
    expect(classify('Bài Mới', 'Hồng Nhung', 'Dance')).toBe(GENRE_LABELS.xua);
    expect(classify('Bài Mới', 'Quang Lê', 'Alternative')).toBe(GENRE_LABELS.bolero);
  });

  it("falls back to the review file's artist, then to V-Pop", () => {
    expect(classify('Bài Lạ', 'Ca Sĩ Lạ', 'Pop', 'ngot')).toBe(GENRE_LABELS.indie);
    expect(classify('Bài Lạ', 'Ca Sĩ Lạ', 'Pop')).toBe(GENRE_LABELS.vpop);
    expect(classify('Bài Lạ', 'Ai Đó', 'Pop')).toBe(GENRE_LABELS.vpop); // curated, no genre set
  });

  it('every curated artist has a known main genre', async () => {
    const { parseArtists } = await import('./artists');
    const list = parseArtists((await import('@/catalog/artists.vpop.json')).default);
    const missing = list.filter((a) => !a.genre || !(a.genre in GENRE_LABELS)).map((a) => a.name);
    expect(missing).toEqual([]);
  });
});
