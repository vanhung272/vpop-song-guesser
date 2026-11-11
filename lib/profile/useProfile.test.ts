// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

let sessionError: Error | null;
const resetSession = vi.fn(async () => 'u2');
vi.mock('@/lib/supabase/client', () => ({
  ensureAnonymousSession: async () => {
    if (sessionError) throw sessionError;
    return 'u1';
  },
  resetAnonymousSession: () => resetSession(),
}));

import { useProfile } from './useProfile';

let profileResponse: Response;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionError = null;
  resetSession.mockClear();
  profileResponse = new Response(JSON.stringify({ error: 'PROFILE_NOT_FOUND' }), { status: 404 });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: 'u1', ...body }), { status: 200 });
    }
    return profileResponse;
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useProfile', () => {
  it('signs in and reports needs-profile on first visit', async () => {
    const { result } = renderHook(() => useProfile());
    expect(result.current.status).toBe('loading');
    await vi.waitFor(() => expect(result.current.status).toBe('needs-profile'));
    expect(fetchMock).toHaveBeenCalledWith('/api/profile', expect.anything());
  });

  it('is ready with the stored profile', async () => {
    profileResponse = new Response(JSON.stringify({ id: 'u1', nickname: 'Hùng', avatarSeed: 's' }), {
      status: 200,
    });
    const { result } = renderHook(() => useProfile());
    await vi.waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.profile).toEqual({ id: 'u1', nickname: 'Hùng', avatarSeed: 's' });
  });

  it('save posts the profile and becomes ready', async () => {
    const { result } = renderHook(() => useProfile());
    await vi.waitFor(() => expect(result.current.status).toBe('needs-profile'));
    let err: string | null = 'unset';
    await act(async () => {
      err = await result.current.save('Mèo', 'seed-9');
    });
    expect(err).toBeNull();
    expect(result.current.status).toBe('ready');
    expect(result.current.profile).toEqual({ id: 'u1', nickname: 'Mèo', avatarSeed: 'seed-9' });
  });

  it('reports an error when anonymous sign-in fails', async () => {
    sessionError = new Error('disabled');
    const { result } = renderHook(() => useProfile());
    await vi.waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Không kết nối được máy chủ. Hãy tải lại trang.');
  });

  it('a 401 (stale session) signs in afresh once, then loads the profile', async () => {
    const responses = [
      new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 }),
      new Response(JSON.stringify({ error: 'PROFILE_NOT_FOUND' }), { status: 404 }),
    ];
    fetchMock.mockImplementation(async () => responses.shift()!);
    const { result } = renderHook(() => useProfile());
    await vi.waitFor(() => expect(result.current.status).toBe('needs-profile'));
    expect(resetSession).toHaveBeenCalledTimes(1);
  });

  it('a second 401 after the fresh sign-in is an error, not a loop', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 }),
    );
    const { result } = renderHook(() => useProfile());
    await vi.waitFor(() => expect(result.current.status).toBe('error'));
    expect(resetSession).toHaveBeenCalledTimes(1);
  });
});
