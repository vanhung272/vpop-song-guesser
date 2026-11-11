import { beforeEach, describe, expect, it, vi } from 'vitest';

let user: { id: string } | null;
let profileExists: boolean;
let answerImpl: (code: string, playerId: string, answerId: string) => Promise<unknown>;
let answerCalls: unknown[][];
let nowMs: number;
let serviceClock: { now(): number } | null;

vi.mock('@/lib/rooms/clock', () => ({ systemClock: { now: () => nowMs } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        nowMs += 400; // auth round trips take time
        return { data: { user }, error: null };
      },
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profileExists ? { id: user?.id } : null, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/rooms/notify', () => ({ createRoomNotifier: () => async () => {} }));
vi.mock('@/lib/rooms/room-service', () => ({
  createRoomService: (deps: { clock: { now(): number } }) => ({
    answer: (code: string, playerId: string, answerId: string) => {
      serviceClock = deps.clock;
      answerCalls.push([code, playerId, answerId]);
      return answerImpl(code, playerId, answerId);
    },
  }),
}));

import { POST } from './route';

const call = (code: string, body: unknown) =>
  POST(
    new Request(`http://localhost/api/rooms/${code}/answer`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ code }) },
  );

beforeEach(() => {
  user = { id: 'user-1' };
  profileExists = true;
  answerCalls = [];
  nowMs = 10_000;
  serviceClock = null;
  answerImpl = async () => ({ ok: true, data: { version: 9 } });
});

describe('POST /api/rooms/:code/answer', () => {
  it('passes code, session user and answerId to the service', async () => {
    const res = await call('12345', { answerId: 'abc' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 9 });
    expect(answerCalls).toEqual([['12345', 'user-1', 'abc']]);
  });

  it('scores the answer at request receive time, before authentication round trips', async () => {
    await call('12345', { answerId: 'abc' });
    expect(serviceClock?.now()).toBe(10_000);
  });

  it('401 without a session', async () => {
    user = null;
    const res = await call('12345', { answerId: 'abc' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'UNAUTHENTICATED' });
    expect(answerCalls).toEqual([]);
  });

  it('403 without a profile', async () => {
    profileExists = false;
    const res = await call('12345', { answerId: 'abc' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'PROFILE_REQUIRED' });
  });

  it('404 for a malformed room code', async () => {
    const res = await call('12a45', { answerId: 'abc' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'ROOM_NOT_FOUND' });
  });

  it('400 for a bad body', async () => {
    for (const body of ['not json', { answerId: 3 }, {}, { answerId: '' }]) {
      const res = await call('12345', body);
      expect(res.status).toBe(400);
    }
    expect(answerCalls).toEqual([]);
  });

  it('maps service errors to their status and code', async () => {
    answerImpl = async () => ({ ok: false, status: 409, error: 'TOO_LATE' });
    const res = await call('12345', { answerId: 'abc' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'TOO_LATE' });
  });

  it('500 when the service throws', async () => {
    answerImpl = async () => {
      throw new Error('db down');
    };
    const res = await call('12345', { answerId: 'abc' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL' });
  });
});
