// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

type BroadcastHandler = (msg: { payload: unknown }) => void;
type StatusHandler = (status: string) => void;

let broadcast: BroadcastHandler | null;
let onStatus: StatusHandler | null;
const removeChannel = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (name: string) => {
      const ch = {
        name,
        on: (_type: string, _filter: unknown, handler: BroadcastHandler) => {
          broadcast = handler;
          return ch;
        },
        subscribe: (cb: StatusHandler) => {
          onStatus = cb;
          return ch;
        },
      };
      return ch;
    },
    removeChannel,
  }),
}));

import { useRoom } from './useRoom';

let serverVersion: number;
let fetchMock: ReturnType<typeof vi.fn>;

const snapshotGets = () =>
  fetchMock.mock.calls.filter(([url, init]) => url === '/api/rooms/12345' && (init?.method ?? 'GET') === 'GET')
    .length;

beforeEach(() => {
  broadcast = null;
  onStatus = null;
  serverVersion = 3;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/rooms/12345' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ code: '12345', version: serverVersion, isMember: true }), {
        status: 200,
      });
    }
    if (url === '/api/rooms/12345/start') {
      serverVersion = 9;
      return new Response(JSON.stringify({ version: 9, changed: true }), { status: 200 });
    }
    if (url === '/api/rooms/12345/theme') {
      serverVersion = 12;
      return new Response(
        JSON.stringify({ version: 12, changed: true, snapshot: { code: '12345', version: 12, isMember: true, tag: 'from-command' } }),
        { status: 200 },
      );
    }
    if (url === '/api/rooms/12345/join') {
      return new Response(JSON.stringify({ error: 'ROOM_FULL' }), { status: 409 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mountRoom() {
  const hook = renderHook(() => useRoom('12345'));
  await vi.waitFor(() => expect(hook.result.current.snapshot?.version).toBe(3));
  return hook;
}

describe('useRoom', () => {
  it('subscribes to the room channel and loads the snapshot', async () => {
    const { result } = await mountRoom();
    expect(result.current.snapshot).toMatchObject({ code: '12345', version: 3 });
    expect(broadcast).not.toBeNull();
  });

  it('useRoom refetches when a broadcast carries a newer version and ignores older ones', async () => {
    const { result } = await mountRoom();
    const before = snapshotGets();

    act(() => broadcast!({ payload: { version: 2 } }));
    act(() => broadcast!({ payload: { version: 3 } }));
    act(() => broadcast!({ payload: { nope: true } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(snapshotGets()).toBe(before);

    serverVersion = 5;
    act(() => broadcast!({ payload: { version: 5 } }));
    await vi.waitFor(() => expect(result.current.snapshot?.version).toBe(5));
    expect(snapshotGets()).toBe(before + 1);
  });

  it('a burst of broadcasts (e.g. 30 players answering) costs one refetch, not one each', async () => {
    const { result } = await mountRoom();
    const before = snapshotGets();
    serverVersion = 40;
    act(() => {
      for (let v = 4; v <= 40; v++) broadcast!({ payload: { version: v } });
    });
    await vi.waitFor(() => expect(result.current.snapshot?.version).toBe(40));
    await new Promise((r) => setTimeout(r, 400));
    expect(snapshotGets()).toBe(before + 1);
  });

  it('never replaces a snapshot with an older one that arrives late', async () => {
    const { result } = await mountRoom();
    serverVersion = 7;
    act(() => broadcast!({ payload: { version: 7 } }));
    await vi.waitFor(() => expect(result.current.snapshot?.version).toBe(7));
    serverVersion = 6; // a stale response
    act(() => onStatus!('SUBSCRIBED'));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.snapshot?.version).toBe(7);
  });

  it('refetches after the channel (re)subscribes', async () => {
    await mountRoom();
    const before = snapshotGets();
    act(() => onStatus!('SUBSCRIBED'));
    await vi.waitFor(() => expect(snapshotGets()).toBe(before + 1));
  });

  it('send posts the command and refetches when it returns a newer version', async () => {
    const { result } = await mountRoom();
    let res: unknown;
    await act(async () => {
      res = await result.current.send({ type: 'start' });
    });
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/rooms/12345/start', expect.objectContaining({ method: 'POST' }));
    await vi.waitFor(() => expect(result.current.snapshot?.version).toBe(9));
  });

  it('send uses the snapshot returned with the command: one round trip, no refetch', async () => {
    const { result } = await mountRoom();
    const gets = snapshotGets();
    let res: unknown;
    await act(async () => {
      res = await result.current.send({ type: 'theme', theme: { type: 'genre', key: 'Pop' } });
    });
    expect(res).toEqual({ ok: true });
    // Applied by the time send resolves, so the caller sees the new state right away.
    expect(result.current.snapshot).toMatchObject({ version: 12, tag: 'from-command' });
    expect(snapshotGets()).toBe(gets);
  });

  it('send returns the error code of a rejected command', async () => {
    const { result } = await mountRoom();
    let res: unknown;
    await act(async () => {
      res = await result.current.send({ type: 'join' });
    });
    expect(res).toEqual({ ok: false, error: 'ROOM_FULL' });
  });

  it('settings and theme are sent as PATCH with a JSON body', async () => {
    const { result } = await mountRoom();
    await act(async () => {
      await result.current.send({ type: 'settings', patch: { questionCount: 5 } });
      await result.current.send({ type: 'theme', theme: { type: 'genre', key: 'Pop' } });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rooms/12345/settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ questionCount: 5 }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rooms/12345/theme',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ type: 'genre', key: 'Pop' }) }),
    );
  });

  it('sends a heartbeat every HEARTBEAT_MS while a member', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountRoom();
    const beats = () => fetchMock.mock.calls.filter(([url]) => url === '/api/rooms/12345/heartbeat').length;
    expect(beats()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(beats()).toBe(1);
  });

  it('removes the channel on unmount', async () => {
    const { unmount } = await mountRoom();
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
