// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RoomSnapshot } from '@/lib/rooms/snapshot';
import type { ProfileState } from '@/lib/profile/useProfile';
import type { RoomCommand, SendResult, UseRoomResult } from './useRoom';
import { T0, player, round, snapshot } from './test-fixtures';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let roomState: UseRoomResult;
vi.mock('./useRoom', () => ({ useRoom: () => roomState }));

const readyProfile: ProfileState = {
  status: 'ready',
  profile: { id: 'g', nickname: 'Khách', avatarSeed: 's' },
  error: null,
  save: async () => null,
};
vi.mock('@/lib/profile/useProfile', () => ({ useProfile: () => readyProfile }));

import { RoomClient } from './RoomClient';

let send: ReturnType<typeof vi.fn<(cmd: RoomCommand) => Promise<SendResult>>>;
let joinResults: SendResult[];

const lobby = (overrides: Partial<RoomSnapshot> = {}) =>
  snapshot({ phase: 'lobby', phaseEndsAt: null, round: null, ...overrides });
const joins = () => send.mock.calls.filter(([c]) => c.type === 'join').length;

function setRoom(s: RoomSnapshot | null) {
  roomState = { snapshot: s, error: null, send };
}

beforeEach(() => {
  push.mockReset();
  joinResults = [];
  send = vi.fn(async (cmd: RoomCommand) =>
    cmd.type === 'join' ? (joinResults.shift() ?? { ok: true as const }) : { ok: true as const },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => {});

describe('<RoomClient /> join and leave', () => {
  it('a player who clicks "Rời phòng" is not re-joined when the refetch shows them gone', async () => {
    setRoom(lobby({ isMember: true }));
    const { rerender } = render(<RoomClient code="12345" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rời phòng' }));
    });
    expect(send).toHaveBeenCalledWith({ type: 'leave' });
    setRoom(lobby({ version: 2, isMember: false }));
    rerender(<RoomClient code="12345" />);
    await flush();
    expect(joins()).toBe(0);
    expect(push).toHaveBeenCalledWith('/');
  });

  it('a member removed from the room (e.g. by another tab closing) re-joins automatically', async () => {
    setRoom(lobby({ isMember: false }));
    const { rerender } = render(<RoomClient code="12345" />);
    await flush();
    expect(joins()).toBe(1);
    setRoom(lobby({ version: 2, isMember: true }));
    rerender(<RoomClient code="12345" />);
    await flush();
    setRoom(lobby({ version: 3, isMember: false }));
    rerender(<RoomClient code="12345" />);
    await flush();
    expect(joins()).toBe(2);
  });

  it('LATE_JOIN_CLOSED retries joining once the game reaches results', async () => {
    joinResults = [{ ok: false, error: 'LATE_JOIN_CLOSED' }];
    setRoom(snapshot({ isMember: false, phase: 'question' }));
    const { rerender } = render(<RoomClient code="12345" />);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('không cho vào giữa ván');
    expect(screen.getByText('Bạn sẽ tự vào phòng khi ván này kết thúc.')).toBeTruthy();

    setRoom(snapshot({ version: 11, isMember: false, phase: 'reveal' }));
    rerender(<RoomClient code="12345" />);
    await flush();
    expect(joins()).toBe(1);

    setRoom(snapshot({ version: 12, isMember: false, phase: 'results', phaseEndsAt: null, round: null }));
    rerender(<RoomClient code="12345" />);
    await flush();
    expect(joins()).toBe(2);
  });

  it('ROOM_FULL retries when a slot frees up', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => player(`p${i}`));
    joinResults = [{ ok: false, error: 'ROOM_FULL' }];
    setRoom(lobby({ isMember: false, players: ten }));
    const { rerender } = render(<RoomClient code="12345" />);
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Phòng đã đủ 10 người.');

    setRoom(lobby({ version: 2, isMember: false, players: ten.slice(1) }));
    rerender(<RoomClient code="12345" />);
    await flush();
    expect(joins()).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('other join errors offer a retry button', async () => {
    joinResults = [{ ok: false, error: 'NETWORK' }];
    setRoom(lobby({ isMember: false }));
    render(<RoomClient code="12345" />);
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    });
    expect(joins()).toBe(2);
  });
});

describe('<RoomClient /> audio', () => {
  it('audio unlock survives a rematch (no second "Bật âm thanh" click)', async () => {
    setRoom(snapshot({ isMember: true }));
    const { rerender } = render(<RoomClient code="12345" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bật âm thanh' }));
    });
    expect(screen.queryByRole('button', { name: 'Bật âm thanh' })).toBeNull();

    setRoom(lobby({ version: 30, gameNo: 2, isMember: true }));
    rerender(<RoomClient code="12345" />);
    await flush();
    setRoom(
      snapshot({
        version: 40,
        gameNo: 2,
        serverNowMs: T0 + 60_000,
        phaseEndsAt: T0 + 70_000,
        isMember: true,
        round: round({ audioUrl: 'https://audio.test/c.m4a', nextAudioUrl: null }),
      }),
    );
    rerender(<RoomClient code="12345" />);
    await flush();
    expect(screen.queryByRole('button', { name: 'Bật âm thanh' })).toBeNull();
  });
});
