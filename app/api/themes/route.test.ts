import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain function (not vi.fn): a vi.fn that throws is reported as a test error by this Vitest version
// even when the route handles it.
let impl: (db: unknown, opts: unknown) => Promise<unknown>;
let calls: unknown[][];

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ fake: 'db' }) }));
vi.mock('@/lib/themes/themes', async (orig) => ({
  ...(await orig<typeof import('@/lib/themes/themes')>()),
  listThemes: (db: unknown, opts: unknown) => {
    calls.push([db, opts]);
    return impl(db, opts);
  },
}));

import { GET } from './route';

const call = (qs: string) => GET(new Request(`http://localhost/api/themes${qs}`));

beforeEach(() => {
  calls = [];
  impl = async () => [];
});

describe('GET /api/themes', () => {
  it('returns the theme list as JSON and forwards type and q', async () => {
    const data = [{ type: 'genre', key: 'Pop', label: 'Pop', trackCount: 20, playable: true }];
    impl = async () => data;
    const res = await call('?type=genre&q=po');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(data);
    expect(calls).toEqual([[{ fake: 'db' }, { type: 'genre', q: 'po' }]]);
  });

  it('works without params', async () => {
    const res = await call('');
    expect(res.status).toBe(200);
    expect(calls).toEqual([[{ fake: 'db' }, { type: undefined, q: undefined }]]);
  });

  it('rejects an invalid type with 400', async () => {
    const res = await call('?type=bogus');
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('returns 500 when the query fails', async () => {
    impl = async () => {
      throw new Error('boom');
    };
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    const res = await call('');
    expect(res.status).toBe(500);
    expect(logged.flat()).toContainEqual(expect.objectContaining({ message: 'boom' }));
    spy.mockRestore();
  });
});
