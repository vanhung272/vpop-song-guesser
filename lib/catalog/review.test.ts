import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filterSongs, type Artist } from './filter';
import type { ItunesSong } from './itunes';
import { importReviewed, writeReviewFile, type ReviewFile } from './review';
import { createCatalogClient, resolveTarget } from './target';
import sonTungFixture from './__fixtures__/son-tung-m-tp.json';

const artist = { key: 'son-tung-m-tp', name: 'Sơn Tùng M-TP', aliases: ['Son Tung M-TP'] };

// Synthetic ids far outside real iTunes ids so the test can never touch real catalog rows.
const BASE_ID = 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000) * 100;

function song(i: number, over: Partial<ItunesSong> = {}): ItunesSong {
  return {
    trackId: BASE_ID + i,
    trackName: `Bài Kiểm Thử ${i}`,
    artistName: 'Sơn Tùng M-TP',
    previewUrl: `https://audio.example/${BASE_ID + i}.m4a`,
    artworkUrl100: `https://img.example/${i}/100x100bb.jpg`,
    releaseDate: '2016-05-01T12:00:00Z',
    primaryGenreName: 'Pop',
    ...over,
  };
}

let tmp: string;
let db: SupabaseClient;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'review-'));
  db = createCatalogClient(resolveTarget('local'));
});

afterAll(async () => {
  rmSync(tmp, { recursive: true, force: true });
  await db
    .from('tracks')
    .delete()
    .gte('itunes_track_id', BASE_ID)
    .lt('itunes_track_id', BASE_ID + 100);
});

async function rowsFor(ids: number[]) {
  const { data, error } = await db
    .from('tracks')
    .select('*')
    .in('itunes_track_id', ids)
    .order('itunes_track_id');
  if (error) throw new Error(error.message);
  return data ?? [];
}

function readReview(file: string): ReviewFile {
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('writeReviewFile', () => {
  it('writes kept and dropped (with reasons) as curator-editable JSON named after the artist key', () => {
    const songs = [
      song(90),
      song(91, { trackName: 'Lạc Trôi (Triple D Remix)' }),
      song(92, { artistName: 'Ai Đó' }),
    ];
    const dir = path.join(tmp, 'nested', 'review');
    const file = writeReviewFile(artist.key, filterSongs(songs, artist), dir);

    expect(path.basename(file)).toBe('son-tung-m-tp.json');
    const review = readReview(file);
    expect(review.artistKey).toBe('son-tung-m-tp');
    expect(review.kept).toHaveLength(1);
    expect(review.kept[0]).toEqual({
      include: true,
      itunesTrackId: BASE_ID + 90,
      title: 'Bài Kiểm Thử 90',
      artist: 'Sơn Tùng M-TP',
      genre: 'V-Pop', // filed by lib/catalog/genre.ts; the iTunes label is kept alongside
      itunesGenre: 'Pop',
      releaseYear: 2016,
      previewUrl: `https://audio.example/${BASE_ID + 90}.m4a`,
      coverUrl: 'https://img.example/90/600x600bb.jpg',
    });
    expect(review.dropped.map((d) => [d.reason, d.include])).toEqual([
      ['variant', false],
      ['wrong-artist', false],
    ]);
    expect(review.dropped[0].title).toBe('Lạc Trôi (Triple D Remix)');
  });

  it('keeps Vietnamese text readable (not \\u-escaped) in the file', () => {
    const file = writeReviewFile(artist.key, filterSongs([song(93, { trackName: 'Đừng Làm Trái Tim Anh Đau' })], artist), tmp);
    expect(readFileSync(file, 'utf8')).toContain('Đừng Làm Trái Tim Anh Đau');
  });

  it('files a Tết song under the "Nhạc Xuân & Tết" genre instead of its iTunes genre', () => {
    const file = writeReviewFile(artist.key, filterSongs([song(94, { trackName: 'Chúc Tết Mọi Nhà' })], artist), path.join(tmp, 'tet'));
    expect(readReview(file).kept[0].genre).toBe('Nhạc Xuân & Tết');
  });

  it('writes a review for the real fixture that round-trips through JSON', () => {
    const result = filterSongs(sonTungFixture.results as ItunesSong[], artist);
    const review = readReview(writeReviewFile(artist.key, result, tmp));
    expect(review.kept).toHaveLength(result.kept.length);
    expect(review.dropped).toHaveLength(result.dropped.length);
  });
});

describe('importReviewed', () => {
  it('is idempotent', async () => {
    const ids = [1, 2, 3].map((i) => BASE_ID + i);
    const dir = path.join(tmp, 'idem');
    const file = writeReviewFile(
      artist.key,
      filterSongs([song(1), song(2), song(3, { trackName: 'Bài Kiểm Thử 3 (Live)' })], artist),
      dir,
    );
    // the variant is dropped, so only 2 rows are imported
    const first = await importReviewed(file, db);
    const second = await importReviewed(file, db);
    expect(first.upserted).toBe(2);
    expect(second.upserted).toBe(2);

    const rows = await rowsFor(ids);
    expect(rows).toHaveLength(2);
    const ids1 = rows.map((r) => r.id);
    await importReviewed(file, db);
    expect((await rowsFor(ids)).map((r) => r.id)).toEqual(ids1); // same rows, ids untouched
  });

  it('maps fields: language vi, normalized columns, 5-year period from releaseYear, 600px cover', async () => {
    const file = writeReviewFile(
      artist.key,
      filterSongs([song(10, { trackName: 'Đừng Làm Trái Tim Anh Đau', releaseDate: '1998-02-02T00:00:00Z' })], artist),
      path.join(tmp, 'map'),
    );
    await importReviewed(file, db);
    const [row] = await rowsFor([BASE_ID + 10]);
    expect(row).toMatchObject({
      title: 'Đừng Làm Trái Tim Anh Đau',
      title_norm: 'dung lam trai tim anh dau',
      artist: 'Sơn Tùng M-TP',
      artist_norm: 'son tung m-tp',
      language: 'vi',
      genre: 'V-Pop',
      decade: '1995-1999',
      preview_url: `https://audio.example/${BASE_ID + 10}.m4a`,
      cover_url: 'https://img.example/10/600x600bb.jpg',
    });
  });

  it('respects curator overrides', async () => {
    const songs = [
      song(20),
      song(21),
      song(22, { trackName: 'Bài Kiểm Thử 22 (Remix)' }), // dropped as variant; curator re-includes it
      song(23, { artistName: 'Ai Đó' }), // dropped as wrong artist; stays dropped
    ];
    const file = writeReviewFile(artist.key, filterSongs(songs, artist), path.join(tmp, 'ovr'));
    const review = readReview(file);

    review.kept[0].title = 'Tên Đã Sửa'; // edited title
    review.kept[0].releaseYear = 1994; // corrected release year
    review.kept[0].genre = 'Rock'; // edited genre
    review.kept[1].include = false; // curator removed this one
    review.dropped.find((d) => d.itunesTrackId === BASE_ID + 22)!.include = true; // re-included
    writeFileSync(file, JSON.stringify(review, null, 2));

    const res = await importReviewed(file, db);
    expect(res.upserted).toBe(2);

    const rows = await rowsFor([20, 21, 22, 23].map((i) => BASE_ID + i));
    expect(rows.map((r) => r.itunes_track_id)).toEqual([BASE_ID + 20, BASE_ID + 22]);
    expect(rows[0]).toMatchObject({
      title: 'Tên Đã Sửa',
      title_norm: 'ten da sua',
      decade: '1990-1994',
      genre: 'Rock',
      language: 'vi',
    });
    expect(rows[1].title).toBe('Bài Kiểm Thử 22 (Remix)');

    // a later edit + re-import updates the existing row instead of duplicating it
    review.kept[0].title = 'Tên Sửa Lần Hai';
    writeFileSync(file, JSON.stringify(review, null, 2));
    await importReviewed(file, db);
    const again = await rowsFor([BASE_ID + 20]);
    expect(again).toHaveLength(1);
    expect(again[0].title).toBe('Tên Sửa Lần Hai');
    expect(again[0].id).toBe(rows[0].id);
  });

  it('skips entries without a previewUrl and reports them instead of failing', async () => {
    const file = writeReviewFile(artist.key, filterSongs([song(30), song(31)], artist), path.join(tmp, 'skip'));
    const review = readReview(file);
    review.kept[1].previewUrl = '';
    writeFileSync(file, JSON.stringify(review));
    const res = await importReviewed(file, db);
    expect(res).toEqual({ upserted: 1, skipped: 1, deleted: 0 });
    expect(await rowsFor([BASE_ID + 31])).toHaveLength(0);
  });

  it('rejects a malformed review file with a descriptive error', async () => {
    const file = path.join(tmp, 'bad.json');
    writeFileSync(file, JSON.stringify({ nope: true }));
    await expect(importReviewed(file, db)).rejects.toThrow(/review file/i);
  });

  it('rejects hand edits with the wrong types instead of importing them', async () => {
    const good = readReview(writeReviewFile(artist.key, filterSongs([song(40)], artist), path.join(tmp, 'types')));
    const cases: [string, (r: ReviewFile) => void][] = [
      ['artistKey', (r) => ((r as unknown as { artistKey: unknown }).artistKey = null)],
      ['include', (r) => ((r.kept[0] as unknown as { include: unknown }).include = 'false')],
    ];
    for (const [field, spoil] of cases) {
      const review = structuredClone(good);
      spoil(review);
      const file = path.join(tmp, `types-${field}.json`);
      writeFileSync(file, JSON.stringify(review));
      await expect(importReviewed(file, db)).rejects.toThrow(new RegExp(field));
    }
    expect(await rowsFor([BASE_ID + 40])).toHaveLength(0);
  });
});

describe('importReviewed: artist_keys (R4b) and removals (R3c)', () => {
  const curated: Artist[] = [
    { key: 'den-vau', name: 'Đen Vâu', aliases: ['Đen', 'Den'] },
    { key: 'min', name: 'MIN' },
    { key: 'son-tung-m-tp', name: 'Sơn Tùng M-TP' },
  ];
  const den: Artist = curated[0];
  const min: Artist = curated[1];

  async function importFor(artist: Artist, songs: ItunesSong[], dir: string, edit?: (r: ReviewFile) => void) {
    const file = writeReviewFile(artist.key, filterSongs(songs, artist), path.join(tmp, dir));
    if (edit) {
      const review = readReview(file);
      edit(review);
      writeFileSync(file, JSON.stringify(review));
    }
    return importReviewed(file, db, curated);
  }

  it('a collab track gets the keys of every curated artist credited; a solo track gets one', async () => {
    await importFor(
      den,
      [
        song(40, { artistName: 'Đen & MIN', trackName: 'Bài Này Chill Phết (kt)' }),
        song(41, { artistName: 'Đen', trackName: 'Lối Nhỏ (kt)' }),
        song(42, { artistName: 'Đen, Kimmese & Lynk Lee', trackName: 'Rapcoustic (kt)' }),
      ],
      'keys1',
    );
    const rows = await rowsFor([40, 41, 42].map((i) => BASE_ID + i));
    expect(rows[0].artist).toBe('Đen & MIN'); // full iTunes credit is kept
    expect(rows[0].artist_norm).toBe('den & min');
    expect([...rows[0].artist_keys].sort()).toEqual(['den-vau', 'min']);
    expect(rows[1].artist_keys).toEqual(['den-vau']);
    expect(rows[2].artist_keys).toEqual(['den-vau']); // non-curated co-credits add nothing
  });

  it("always includes the review file's own artist key, even if the curator edited the credit", async () => {
    await importFor(den, [song(43, { artistName: 'Đen' })], 'keys2', (r) => {
      r.kept[0].artist = 'Ai Đó Khác';
    });
    const [row] = await rowsFor([BASE_ID + 43]);
    expect(row.artist).toBe('Ai Đó Khác');
    expect(row.artist_keys).toEqual(['den-vau']);
  });

  it('a collection file (no artistKey) only tags curated artists actually credited', async () => {
    const entry = (i: number, title: string, artistName: string) => ({
      include: true,
      itunesTrackId: BASE_ID + i,
      title,
      artist: artistName,
      genre: 'Nhạc Xuân & Tết',
      releaseYear: 2007,
      previewUrl: `https://audio.example/${BASE_ID + i}.m4a`,
      coverUrl: null,
    });
    const file = path.join(tmp, 'collection.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        collection: 'tet-classics',
        note: 'test',
        kept: [entry(60, 'Xuân Này Con Không Về (kt)', 'Quang Lê'), entry(61, 'Tết Chung (kt)', 'Đen & Ai Đó')],
        dropped: [],
      }),
    );
    expect(await importReviewed(file, db, curated)).toEqual({ upserted: 2, skipped: 0, deleted: 0 });
    const rows = await rowsFor([BASE_ID + 60, BASE_ID + 61]);
    expect(rows[0]).toMatchObject({ artist: 'Quang Lê', artist_keys: [], genre: 'Nhạc Xuân & Tết', decade: '2005-2009' });
    expect(rows[1].artist_keys).toEqual(['den-vau']);
  });

  it('a review file needs either an artistKey or a collection name', async () => {
    const file = path.join(tmp, 'neither.json');
    writeFileSync(file, JSON.stringify({ version: 1, note: '', kept: [], dropped: [] }));
    await expect(importReviewed(file, db, curated)).rejects.toThrow(/artistKey/);
  });

  it('re-importing the same track from a second artist file merges keys (union, no loss)', async () => {
    const s = song(44, { artistName: 'Đen', trackName: 'Bài Chung (kt)' });
    await importFor(den, [s], 'keys3a');
    expect((await rowsFor([BASE_ID + 44]))[0].artist_keys).toEqual(['den-vau']);

    // MIN's file lists the same iTunes track as a wrong-artist drop; the curator re-includes it
    // (credit string unchanged, so only the file key adds 'min')
    await importFor(min, [s], 'keys3b', (r) => {
      r.dropped[0].include = true;
    });
    expect([...(await rowsFor([BASE_ID + 44]))[0].artist_keys].sort()).toEqual(['den-vau', 'min']);

    // and importing Đen's file again does not drop 'min'
    await importFor(den, [s], 'keys3c');
    expect([...(await rowsFor([BASE_ID + 44]))[0].artist_keys].sort()).toEqual(['den-vau', 'min']);
  });

  it('include:false on a kept song deletes that itunes_track_id from tracks', async () => {
    const songs = [song(45, { artistName: 'Đen', trackName: 'Giữ Lại (kt)' }), song(46, { artistName: 'Đen', trackName: 'Sẽ Xóa (kt)' })];
    await importFor(den, songs, 'del1');
    expect(await rowsFor([BASE_ID + 45, BASE_ID + 46])).toHaveLength(2);

    const res = await importFor(den, songs, 'del1', (r) => {
      r.kept[1].include = false;
    });
    expect(res).toMatchObject({ upserted: 1, deleted: 1 });
    const rows = await rowsFor([BASE_ID + 45, BASE_ID + 46]);
    expect(rows.map((r) => r.itunes_track_id)).toEqual([BASE_ID + 45]);
  });

  it('untouched dropped entries (include:false by default) never delete anything', async () => {
    const keep = song(47, { artistName: 'Đen', trackName: 'Có Sẵn (kt)' });
    await importFor(den, [keep], 'del2a');
    // the same track shows up as a wrong-artist drop in another artist's file
    const res = await importFor(min, [song(48, { trackName: 'Của Min (kt)', artistName: 'MIN' }), { ...keep, artistName: 'Ai Đó' }], 'del2b');
    expect(res.deleted).toBe(0);
    expect(await rowsFor([BASE_ID + 47])).toHaveLength(1);
  });
});
