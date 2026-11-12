import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTrackRowsCache, listThemes } from './themes';

/** Minimal PostgREST stand-in for the paged `tracks` read; counts how often it is queried. */
function fakeDb(rows: unknown[]) {
  let queries = 0;
  const db = {
    from: () => {
      queries++;
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        range: async () => ({ data: rows, error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, queries: () => queries };
}

const rows = [{ artist_keys: ['den-vau'], genre: 'Pop', decade: '2015-2019' }];

describe('createTrackRowsCache', () => {
  it('reads the catalog once per TTL, then again after it expires', async () => {
    const { db, queries } = fakeDb(rows);
    const cached = createTrackRowsCache(60_000);
    expect(await cached(db, 0)).toEqual(rows);
    expect(await cached(db, 59_999)).toEqual(rows);
    expect(queries()).toBe(1);
    await cached(db, 60_000);
    expect(queries()).toBe(2);
  });

  it('shares one read between concurrent callers', async () => {
    const { db, queries } = fakeDb(rows);
    const cached = createTrackRowsCache(60_000);
    await Promise.all([cached(db, 0), cached(db, 1), cached(db, 2)]);
    expect(queries()).toBe(1);
  });

  it('does not keep a failed read', async () => {
    let fail = true;
    let queries = 0;
    const db = {
      from: () => {
        queries++;
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          range: async () => (fail ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }),
        };
        return q;
      },
    } as unknown as SupabaseClient;
    const cached = createTrackRowsCache(60_000);
    await expect(cached(db, 0)).rejects.toThrow(/boom/);
    fail = false;
    expect(await cached(db, 1)).toEqual(rows);
    expect(queries).toBe(2);
  });
});

describe('listThemes with preloaded rows', () => {
  it('uses the given rows without querying, and lists artist aliases for client-side search', async () => {
    const db = { from: () => { throw new Error('should not query'); } } as unknown as SupabaseClient;
    const artists = [{ key: 'den-vau', name: 'Đen Vâu', aliases: ['Đen', 'Den Vau'] }];
    const out = await listThemes(db, { type: 'artist' }, { artists, rows });
    expect(out).toEqual([
      { type: 'artist', key: 'den-vau', label: 'Đen Vâu', trackCount: 1, playable: false, aliases: ['Đen', 'Den Vau'] },
    ]);
  });
});
