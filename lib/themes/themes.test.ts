import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCatalogClient, resolveTarget } from '@/lib/catalog/target';
import { listThemes, periodLabel, themeLabel } from './themes';

// Synthetic ids far outside real iTunes ids so the test never touches real catalog rows.
const BASE_ID = 9_100_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1000;
const RUN = Math.random().toString(36).slice(2, 8);
const GENRE = `ZZ Test Genre ${RUN}`;
const SMALL_GENRE = `ZZ Small Genre ${RUN}`;
const DECADE = '1890-1894'; // no real catalog track is this old
const OLDER = '1885-1889';

const artists = [
  { key: `zz-big-${RUN}`, name: 'Nghệ Sĩ Lớn', aliases: ['Nghe Si Lon'] },
  { key: `zz-small-${RUN}`, name: 'Nghệ Sĩ Nhỏ', aliases: [] },
];

let db: SupabaseClient;
let next = 0;

async function seed(n: number, over: Record<string, unknown>) {
  const rows = Array.from({ length: n }, () => {
    const i = next++;
    return {
      itunes_track_id: BASE_ID + i,
      preview_url: `https://audio.example/${BASE_ID + i}.m4a`,
      title: `Bài Thử ${i}`,
      title_norm: `bai thu ${i}`,
      artist: 'Nghệ Sĩ Lớn',
      artist_norm: 'nghe si lon',
      language: 'vi',
      genre: null,
      decade: null,
      artist_keys: [],
      ...over,
    };
  });
  const { error } = await db.from('tracks').insert(rows);
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  db = createCatalogClient(resolveTarget('local'));
  await seed(16, { artist_keys: [artists[0].key], genre: GENRE, decade: DECADE });
  await seed(3, { artist_keys: [artists[1].key, artists[0].key], genre: SMALL_GENRE });
  // not Vietnamese: must not be counted anywhere
  await seed(4, { artist_keys: [artists[1].key], genre: GENRE, decade: DECADE, language: 'en' });
  // real curated artists, for q matching against the shipped artists file
  await seed(1, { artist_keys: ['son-tung-m-tp'] });
  await seed(1, { artist_keys: ['den-vau', 'son-tung-m-tp'] });
});

afterAll(async () => {
  await db
    .from('tracks')
    .delete()
    .gte('itunes_track_id', BASE_ID)
    .lt('itunes_track_id', BASE_ID + 1000);
});

describe('listThemes', () => {
  it('q "son tung" matches "Sơn Tùng M-TP"', async () => {
    const res = await listThemes(db, { q: 'son tung' });
    const hit = res.find((t) => t.type === 'artist' && t.key === 'son-tung-m-tp');
    expect(hit?.label).toBe('Sơn Tùng M-TP');
    expect(res.every((t) => t.type === 'artist')).toBe(true);
  });

  it('q "DEN" matches "Đen Vâu" (name and alias, case/diacritics ignored)', async () => {
    const res = await listThemes(db, { q: 'DEN' });
    expect(res.find((t) => t.key === 'den-vau')?.label).toBe('Đen Vâu');
  });

  it('q matches genre and decade labels', async () => {
    const g = await listThemes(db, { q: GENRE.toUpperCase() });
    expect(g.map((t) => [t.type, t.key])).toContainEqual(['genre', GENRE]);
    const d = await listThemes(db, { q: '1890' });
    expect(d.map((t) => [t.type, t.key])).toContainEqual(['decade', DECADE]);
  });

  it('type filter returns only that type', async () => {
    for (const type of ['artist', 'genre', 'decade'] as const) {
      const res = await listThemes(db, { type }, { artists });
      expect(res.length).toBeGreaterThan(0);
      expect(res.every((t) => t.type === type)).toBe(true);
    }
  });

  it('trackCount equals number of vi tracks in the theme (a track counts for each credited artist)', async () => {
    const res = await listThemes(db, {}, { artists });
    const get = (type: string, key: string) => res.find((t) => t.type === type && t.key === key);
    expect(get('artist', artists[0].key)?.trackCount).toBe(16 + 3);
    expect(get('artist', artists[1].key)?.trackCount).toBe(3);
    expect(get('genre', GENRE)?.trackCount).toBe(16);
    expect(get('genre', SMALL_GENRE)?.trackCount).toBe(3);
    expect(get('decade', DECADE)?.trackCount).toBe(16);
    expect(get('genre', GENRE)?.label).toBe(GENRE);
    expect(get('artist', artists[0].key)?.label).toBe('Nghệ Sĩ Lớn');
  });

  it('theme with fewer than 15 tracks reports playable=false', async () => {
    const res = await listThemes(db, {}, { artists });
    const get = (type: string, key: string) => res.find((t) => t.type === type && t.key === key);
    expect(get('genre', SMALL_GENRE)?.playable).toBe(false);
    expect(get('artist', artists[1].key)?.playable).toBe(false);
    expect(get('genre', GENRE)?.playable).toBe(true);
  });

  it('omits themes without tracks and sorts playable first, then count desc, then label', async () => {
    const res = await listThemes(
      db,
      {},
      { artists: [...artists, { key: 'zz-empty', name: 'Rỗng', aliases: [] }] },
    );
    expect(res.find((t) => t.key === 'zz-empty')).toBeUndefined();
    for (let i = 1; i < res.length; i++) {
      const a = res[i - 1];
      const b = res[i];
      if (a.playable !== b.playable) expect(a.playable).toBe(true);
      else if (a.trackCount !== b.trackCount) expect(a.trackCount).toBeGreaterThan(b.trackCount);
    }
  });

  it('release-period themes list the newest period first', async () => {
    await seed(16, { artist_keys: [artists[0].key], genre: GENRE, decade: OLDER });
    const res = (await listThemes(db, { type: 'decade' })).filter((t) => t.key === DECADE || t.key === OLDER);
    expect(res.map((t) => t.key)).toEqual([DECADE, OLDER]);
    expect(res[0].label).toBe('1890 – 1894');
  });
});

describe('periodLabel / themeLabel', () => {
  it('shows a 5-year period as a range, and the running one as "nay"', () => {
    expect(periodLabel('2015-2019', 2026)).toBe('2015 – 2019');
    expect(periodLabel('2025-2029', 2026)).toBe('2025 – nay');
    expect(periodLabel('2010s', 2026)).toBe('2010s'); // anything else passes through
  });

  it('themeLabel uses the period label for release-period themes', () => {
    expect(themeLabel({ type: 'decade', key: '2015-2019' })).toBe('2015 – 2019');
    expect(themeLabel({ type: 'genre', key: 'Pop' })).toBe('Pop');
  });

  it('themeLabel names the random theme', () => {
    expect(themeLabel({ type: 'random', key: 'all' })).toBe('Ngẫu nhiên');
  });
});

describe('random theme', () => {
  it('is one theme over every Vietnamese track', async () => {
    const res = await listThemes(db, { type: 'random' });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ type: 'random', key: 'all', label: 'Ngẫu nhiên', playable: true });
    const { count } = await db.from('tracks').select('id', { count: 'exact', head: true }).eq('language', 'vi');
    expect(res[0].trackCount).toBe(count);
  });
});
