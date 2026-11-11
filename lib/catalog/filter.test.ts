import { describe, expect, it } from 'vitest';
import {
  creditedArtists,
  filterSongs,
  isTetSong,
  matchesArtist,
  periodOfYear,
  releaseYearFromDate,
  TET_GENRE,
  type Artist,
} from './filter';
import type { ItunesSong } from './itunes';
import denVauFixture from './__fixtures__/den-vau.json';
import sonTungFixture from './__fixtures__/son-tung-m-tp.json';
import trinhFixture from './__fixtures__/trinh-cong-son.json';

const denVau: Artist = { key: 'den-vau', name: 'Đen Vâu', aliases: ['Đen', 'Den'] };
const sonTung: Artist = {
  key: 'son-tung-m-tp',
  name: 'Sơn Tùng M-TP',
  aliases: ['Son Tung M-TP', 'Sơn Tùng MTP'],
};
const trinh: Artist = { key: 'trinh-cong-son', name: 'Trịnh Công Sơn' };

let nextId = 1;
function song(over: Partial<ItunesSong> = {}): ItunesSong {
  const id = nextId++;
  return {
    trackId: id,
    trackName: `Bài ${id}`,
    artistName: 'Sơn Tùng M-TP',
    previewUrl: `https://audio.example/${id}.m4a`,
    artworkUrl100: `https://img.example/${id}/100x100bb.jpg`,
    releaseDate: '2016-05-01T12:00:00Z',
    primaryGenreName: 'Pop',
    ...over,
  };
}

const fx = (f: { results: unknown[] }) => f.results as ItunesSong[];

describe('filterSongs', () => {
  it('drops songs whose artistName does not match', () => {
    const songs = fx(denVauFixture);
    const { kept, dropped } = filterSongs(songs, denVau);

    expect(kept.length + dropped.length).toBe(songs.length);
    expect(kept.length).toBeGreaterThan(0);
    for (const s of kept) expect(matchesArtist(s, denVau)).toBe(true);
    const wrong = dropped.filter((d) => d.reason === 'wrong-artist');
    expect(wrong.map((d) => d.song.artistName)).toContain('Binz');
    // real response: only 18 of the 50 hits credit Đen (17 spelled "Đen" + 1 collab credited "Den")
    expect(songs.filter((s) => matchesArtist(s, denVau))).toHaveLength(18);
    expect(wrong).toHaveLength(songs.length - 18);
  });

  it('drops songs whose artistName does not match (Trịnh Công Sơn: unaccented credits, covers)', () => {
    const songs = fx(trinhFixture);
    const { kept, dropped } = filterSongs(songs, trinh);
    expect(kept.length).toBeGreaterThan(0);
    for (const s of kept) expect(creditedArtists(s.artistName)).toContain('trinh cong son');
    const wrongNames = dropped.filter((d) => d.reason === 'wrong-artist').map((d) => d.song.artistName);
    expect(wrongNames).toContain('Lệ Quyên');
    expect(wrongNames).toContain('Trịnh Vĩnh Trinh');
  });

  it('accepts alias spellings and collaborations where the artist is one of the credits', () => {
    expect(matchesArtist(song({ artistName: 'Son Tung M-TP' }), sonTung)).toBe(true);
    expect(matchesArtist(song({ artistName: 'Sơn Tùng MTP' }), sonTung)).toBe(true);
    expect(matchesArtist(song({ artistName: 'Sơn Tùng M-TP & Tyga' }), sonTung)).toBe(true);
    expect(matchesArtist(song({ artistName: 'Snoop Dogg, Sơn Tùng M-TP' }), sonTung)).toBe(true);
    expect(matchesArtist(song({ artistName: 'Snoop Dogg feat. Sơn Tùng M-TP' }), sonTung)).toBe(true);
    expect(matchesArtist(song({ artistName: 'Hoàng Thùy Linh, JustaTee & Den' }), denVau)).toBe(true);
    expect(matchesArtist(song({ artistName: 'Sơn Tùng' }), sonTung)).toBe(false);
    expect(matchesArtist(song({ artistName: 'Sơn Tùng M-TP Fanclub' }), sonTung)).toBe(false);
  });

  it('drops remix/live/instrumental/karaoke/beat variants', () => {
    const variants = [
      'Lạc Trôi (Triple D Remix)',
      'Chạy Ngay Đi (Onionn Remix)',
      'Mười Năm (feat. Ngọc Linh) [Live At Show Của Đen]',
      'Em Của Ngày Hôm Qua (Sky Tour 2019)',
      'Hãy Trao Cho Anh - Instrumental',
      'Hãy Trao Cho Anh (Karaoke Version)',
      'Hãy Trao Cho Anh (Beat)',
      'Hãy Trao Cho Anh (Beat Version)',
      'Hãy Trao Cho Anh (Acoustic)',
      "There's No One At All (Another Version)",
      'Hãy Trao Cho Anh Karaoke',
      'Hãy Trao Cho Anh (Lofi Ver.)',
    ];
    const songs = variants.map((t) => song({ trackName: t }));
    const keeper = song({ trackName: 'Lạc Trôi' });
    const { kept, dropped } = filterSongs([...songs, keeper], sonTung);
    expect(kept).toEqual([keeper]);
    expect(dropped.map((d) => d.reason)).toEqual(variants.map(() => 'variant'));
  });

  it('does not treat ordinary titles as variants', () => {
    const titles = [
      'Live Forever',
      'Beat It',
      'Bài Này Chill Phết',
      'Cho Tôi Lang Thang',
      'Một Năm Mới Bình An',
      'Cảm ơn (feat. Biên)',
    ];
    const songs = titles.map((t) => song({ trackName: t }));
    const { kept, dropped } = filterSongs(songs, sonTung);
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(titles.length);
  });

  it('drops duplicate titleNorm keeping the first', () => {
    const a = song({ trackName: 'Em Của Ngày Hôm Qua' });
    const b = song({ trackName: 'Em Cua Ngay Hom Qua' });
    const c = song({ trackName: 'em của ngày hôm qua ' });
    const other = song({ trackName: 'Lạc Trôi' });
    const { kept, dropped } = filterSongs([a, b, other, c], sonTung);
    expect(kept).toEqual([a, other]);
    expect(dropped).toEqual([
      { song: b, reason: 'duplicate' },
      { song: c, reason: 'duplicate' },
    ]);
  });

  it('drops songs without previewUrl', () => {
    const noPreview = song({ trackName: 'Không Có Preview', previewUrl: undefined });
    const empty = song({ trackName: 'Preview Rỗng', previewUrl: '' });
    const ok = song();
    const { kept, dropped } = filterSongs([noPreview, empty, ok], sonTung);
    expect(kept).toEqual([ok]);
    expect(dropped.map((d) => d.reason)).toEqual(['no-preview', 'no-preview']);
  });

  it('reports wrong-artist first even if the song is also a variant or has no preview', () => {
    const s = song({ artistName: 'Ai Đó', trackName: 'X (Remix)', previewUrl: undefined });
    expect(filterSongs([s], sonTung).dropped).toEqual([{ song: s, reason: 'wrong-artist' }]);
  });

  it('partitions the real Sơn Tùng M-TP response: every song is either kept or dropped once', () => {
    const songs = fx(sonTungFixture);
    const { kept, dropped } = filterSongs(songs, sonTung);
    expect(kept.length + dropped.length).toBe(songs.length);
    const titles = kept.map((s) => s.trackName);
    expect(titles).toContain('Lạc Trôi');
    expect(titles).not.toContain('Lạc Trôi (Triple D Remix)');
    expect(titles).not.toContain('Chạy Ngay Đi (Sky Tour 2019)');
    expect(dropped.some((d) => d.reason === 'duplicate')).toBe(true);
    const norms = new Set(
      kept.map((s) => s.trackName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()),
    );
    expect(norms.size).toBe(kept.length);
  });
});

describe('releaseYearFromDate', () => {
  it('reads the UTC year of an iTunes release date', () => {
    expect(releaseYearFromDate('2017-03-01T12:00:00Z')).toBe(2017);
    expect(releaseYearFromDate('2000-01-01T00:00:00Z')).toBe(2000);
  });
  it('returns null for a missing or invalid date', () => {
    expect(releaseYearFromDate(undefined)).toBeNull();
    expect(releaseYearFromDate('not-a-date')).toBeNull();
  });
});

describe('periodOfYear', () => {
  it('buckets years into 5-year periods', () => {
    expect(periodOfYear(2017)).toBe('2015-2019');
    expect(periodOfYear(2015)).toBe('2015-2019');
    expect(periodOfYear(2014)).toBe('2010-2014');
    expect(periodOfYear(2020)).toBe('2020-2024');
    expect(periodOfYear(2026)).toBe('2025-2029');
    expect(periodOfYear(1998)).toBe('1995-1999');
  });
  it('returns null without a usable year', () => {
    expect(periodOfYear(null)).toBeNull();
    expect(periodOfYear(Number.NaN)).toBeNull();
    expect(periodOfYear(2017.5)).toBeNull();
  });
});

describe('isTetSong', () => {
  it('recognises Tết / spring songs by title', () => {
    for (const title of [
      'Tết Đón Xuân Về',
      'Ngày Tết Việt Nam',
      'Tuổi Gì Mà Chẳng Thích Lì Xì (feat. Bình Gold)',
      'Phút Giao Thừa Diệu Êm',
      'Một Năm Mới Bình An',
      'Em Đã Thấy Mùa Xuân Chưa',
      'Đón Xuân Tuyệt Vời (feat. Chi Pu)',
      'Xuân Đang Đến Bên Em',
      'Đi Về Nhà',
      'Về Nhà Là Khoẻ',
      'Nơi Pháo Hoa Rực Rỡ (Đi Để Trở Về 8) - Single',
      'TẾT LÀ ĐÂY CHỨ ĐÂU',
    ]) {
      expect(isTetSong(title), title).toBe(true);
    }
  });

  it('does not take "xuân" meaning youth, the four seasons, or other homecomings', () => {
    for (const title of [
      'Xuân Thì',
      'Dành Hết Xuân Thì Để Chờ Nhau',
      'Thanh Xuân - Đừng Ngại Ngùng',
      'xuân, hạ, thu, đông rồi lại xuân',
      'Liên Khúc: Xuân Hạ Thu Đông',
      'sao anh chưa về nhà',
      'Người Ôm Pháo Hoa',
      'Một Nơi Bé Nhỏ Nào Đó (Tet 2025 Movie “Bộ Tứ Báo Thủ” Original Soundtrack)',
      'Lạc Trôi',
    ]) {
      expect(isTetSong(title), title).toBe(false);
    }
  });

  it('the genre label is "Nhạc Tết"', () => {
    expect(TET_GENRE).toBe('Nhạc Tết');
  });
});
