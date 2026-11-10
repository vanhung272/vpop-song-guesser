import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filterSongs } from './filter';
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
      genre: 'Pop',
      decade: '2010s',
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

  it('maps fields: language vi, normalized columns, decade from releaseDate, 600px cover', async () => {
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
      genre: 'Pop',
      decade: '1990s',
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
    review.kept[0].decade = '1990s'; // edited decade
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
      decade: '1990s',
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
    expect(res).toEqual({ upserted: 1, skipped: 1 });
    expect(await rowsFor([BASE_ID + 31])).toHaveLength(0);
  });

  it('rejects a malformed review file with a descriptive error', async () => {
    const file = path.join(tmp, 'bad.json');
    writeFileSync(file, JSON.stringify({ nope: true }));
    await expect(importReviewed(file, db)).rejects.toThrow(/review file/i);
  });
});
