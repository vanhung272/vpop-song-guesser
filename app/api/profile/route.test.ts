import { beforeEach, describe, expect, it, vi } from 'vitest';

let user: { id: string } | null;
let upserts: { table: string; row: unknown; options: unknown }[];
let upsertError: { message: string } | null;
let stored: { id: string; nickname: string; avatar_seed: string } | null;
let selectError: { message: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: (row: unknown, options: unknown) => {
        upserts.push({ table, row, options });
        return Promise.resolve({ error: upsertError });
      },
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: selectError ? null : stored && stored.id === id ? stored : null,
            error: selectError,
          }),
        }),
      }),
    }),
  }),
}));

import { GET, POST } from './route';

const call = (body: unknown) =>
  POST(
    new Request('http://localhost/api/profile', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );

beforeEach(() => {
  user = { id: 'user-1' };
  upserts = [];
  upsertError = null;
  stored = null;
  selectError = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/profile', () => {
  it('upserts the profile keyed by the session user and returns it', async () => {
    const res = await call({ nickname: '  Hùng  ', avatarSeed: 'seed-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'user-1', nickname: 'Hùng', avatarSeed: 'seed-1' });
    expect(upserts).toEqual([
      {
        table: 'profiles',
        row: { id: 'user-1', nickname: 'Hùng', avatar_seed: 'seed-1' },
        options: { onConflict: 'id' },
      },
    ]);
  });

  it('401 without a session', async () => {
    user = null;
    const res = await call({ nickname: 'A', avatarSeed: 's' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHENTICATED' });
    expect(upserts).toEqual([]);
  });

  it('nickname empty or longer than 30 chars is rejected', async () => {
    for (const nickname of ['', '   ', 'x'.repeat(31), 5, null, 'a\u0000b', 'a\nb']) {
      const res = await call({ nickname, avatarSeed: 's' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'INVALID_NICKNAME' });
    }
    expect((await call({ nickname: 'x'.repeat(30), avatarSeed: 's' })).status).toBe(200);
    expect((await call({ nickname: ` ${'x'.repeat(30)} `, avatarSeed: 's' })).status).toBe(200);
    expect(upserts).toHaveLength(2);
  });

  it('avatarSeed longer than 64 chars is rejected', async () => {
    for (const avatarSeed of ['', 'x'.repeat(65), 7, undefined]) {
      const res = await call({ nickname: 'A', avatarSeed });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'INVALID_AVATAR_SEED' });
    }
    expect((await call({ nickname: 'A', avatarSeed: 'x'.repeat(64) })).status).toBe(200);
  });

  it('400 INVALID_BODY for a non-object or non-JSON body', async () => {
    for (const body of ['not json', '[]', '"x"']) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'INVALID_BODY' });
    }
  });

  it('500 INTERNAL when the upsert fails', async () => {
    upsertError = { message: 'boom' };
    const res = await call({ nickname: 'A', avatarSeed: 's' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL' });
  });
});

describe('GET /api/profile', () => {
  it('returns the session user profile', async () => {
    stored = { id: 'user-1', nickname: 'Hùng', avatar_seed: 'seed-1' };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'user-1', nickname: 'Hùng', avatarSeed: 'seed-1' });
  });

  it('404 PROFILE_NOT_FOUND when the user has no profile yet', async () => {
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'PROFILE_NOT_FOUND' });
  });

  it('401 without a session', async () => {
    user = null;
    expect((await GET()).status).toBe(401);
  });

  it('500 when the lookup fails', async () => {
    selectError = { message: 'boom' };
    expect((await GET()).status).toBe(500);
  });
});
