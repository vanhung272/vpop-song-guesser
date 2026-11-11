// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RoomSnapshot, SnapshotPlayer } from '@/lib/rooms/snapshot';
import type { ProfileState } from '@/lib/profile/useProfile';
import type { RoomCommand, UseRoomResult } from './useRoom';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let roomState: UseRoomResult;
vi.mock('./useRoom', () => ({ useRoom: () => roomState }));

let profileState: ProfileState;
vi.mock('@/lib/profile/useProfile', () => ({ useProfile: () => profileState }));

import { Lobby } from './Lobby';
import { RoomClient } from './RoomClient';

function player(id: string, overrides: Partial<SnapshotPlayer> = {}): SnapshotPlayer {
  return {
    id,
    nickname: `Người ${id}`,
    avatarSeed: `seed-${id}`,
    score: 0,
    online: true,
    isHost: false,
    joinedRound: 0,
    hasAnswered: false,
    ...overrides,
  };
}

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    serverNowMs: 1_000_000,
    code: '12345',
    version: 1,
    phase: 'lobby',
    phaseEndsAt: null,
    roundIdx: 0,
    questionCount: 10,
    gameNo: 1,
    hostId: 'h',
    viewerId: 'g',
    isHost: false,
    isMember: true,
    settings: { questionCount: 10, timeLimitMs: 15000, showLiveAnswers: true, lateJoin: true },
    theme: { type: 'artist', key: 'den-vau', label: 'Đen Vâu' },
    players: [player('h', { isHost: true, nickname: 'Bảo' }), player('g', { nickname: 'Khách' })],
    round: null,
    history: [],
    ...overrides,
  };
}

const hostSnapshot = () => snapshot({ viewerId: 'h', isHost: true });

let send: ReturnType<typeof vi.fn<(cmd: RoomCommand) => Promise<{ ok: true } | { ok: false; error: string }>>>;

beforeEach(() => {
  send = vi.fn(async () => ({ ok: true as const }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('<Lobby />', () => {
  it('the host theme picker has tabs Ngẫu nhiên / Ca sĩ / Thể loại / Thời gian ra mắt', () => {
    render(<Lobby snapshot={hostSnapshot()} send={send} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Ngẫu nhiên',
      'Ca sĩ',
      'Thể loại',
      'Thời gian ra mắt',
    ]);
    // The lists are short: no search box.
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('the theme list hides themes without enough songs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { type: 'genre', key: 'Pop', label: 'Pop', trackCount: 1406, playable: true },
              { type: 'genre', key: 'Dance', label: 'Dance', trackCount: 7, playable: false },
            ]),
            { status: 200 },
          ),
      ),
    );
    render(<Lobby snapshot={hostSnapshot()} send={send} />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /Pop/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Dance/ })).toBeNull();
    expect(screen.queryByText('chưa đủ bài')).toBeNull();
  });

  it('lists players with a count out of 10 and a host badge', () => {
    render(<Lobby snapshot={snapshot()} send={send} />);
    expect(screen.getByText('2/10')).toBeTruthy();
    const host = screen.getByText('Bảo').closest('li')!;
    expect(within(host).getByText('Chủ phòng', { selector: '.badge' })).toBeTruthy();
  });

  it('non-host sees settings read-only', () => {
    render(<Lobby snapshot={snapshot()} send={send} />);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Bắt đầu' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('10 câu')).toBeTruthy();
    expect(screen.getByText('15 giây')).toBeTruthy();
    expect(screen.queryByText('% đáp án trực tiếp')).toBeNull();
    expect(screen.getByText('Đen Vâu')).toBeTruthy();
    expect(screen.getByText('Chờ chủ phòng bắt đầu…')).toBeTruthy();
  });

  it('host sees settings controls with only the allowed options', () => {
    render(<Lobby snapshot={hostSnapshot()} send={send} />);
    const count = screen.getByLabelText('Số câu') as HTMLSelectElement;
    expect([...count.options].map((o) => o.value)).toEqual(['5', '8', '10', '12', '15']);
    const time = screen.getByLabelText('Thời gian mỗi câu') as HTMLSelectElement;
    expect([...time.options].map((o) => o.value)).toEqual(['10000', '15000', '20000']);
    // Percentages are only shown on the reveal now: no setting for it.
    expect(screen.queryByLabelText('Hiện % đáp án trực tiếp')).toBeNull();
    expect(screen.getByLabelText('Cho vào giữa ván')).toBeTruthy();
  });

  it('host changes are sent as settings commands', () => {
    render(<Lobby snapshot={hostSnapshot()} send={send} />);
    fireEvent.change(screen.getByLabelText('Số câu'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Thời gian mỗi câu'), { target: { value: '20000' } });
    fireEvent.click(screen.getByLabelText('Cho vào giữa ván'));
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'settings', patch: { questionCount: 15 } },
      { type: 'settings', patch: { timeLimitMs: 20000 } },
      { type: 'settings', patch: { lateJoin: false } },
    ]);
  });

  it('host start is disabled until a theme is chosen', () => {
    render(<Lobby snapshot={snapshot({ viewerId: 'h', isHost: true, theme: null })} send={send} />);
    expect((screen.getByRole('button', { name: 'Bắt đầu' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<Lobby snapshot={hostSnapshot()} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    expect(send).toHaveBeenCalledWith({ type: 'start' });
  });

  it('invite link copies the full URL', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Lobby snapshot={snapshot()} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/r/12345`);
    await vi.waitFor(() => expect(screen.getByText('Đã sao chép!')).toBeTruthy());
  });

  it('hiding the room code masks both the code and the link', () => {
    render(<Lobby snapshot={snapshot()} send={send} />);
    expect(screen.getByText('12345')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn mã' }));
    expect(screen.queryByText('12345')).toBeNull();
    expect(screen.queryByText(new RegExp('/r/12345'))).toBeNull();
    expect(screen.queryByRole('img', { name: 'Mã QR vào phòng' })).toBeNull();
  });

  it('a rejected command shows a Vietnamese error message', async () => {
    send = vi.fn(async () => ({ ok: false as const, error: 'THEME_REQUIRED' }));
    render(<Lobby snapshot={hostSnapshot()} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Hãy chọn chủ đề trước khi bắt đầu.'),
    );
  });
  it('start shows a pending state and ignores repeat clicks while the server checks previews', async () => {
    let finish!: (r: { ok: true }) => void;
    send = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    render(<Lobby snapshot={hostSnapshot()} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    const pending = screen.getByRole('button', { name: 'Đang bắt đầu…' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(send).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeTruthy());
  });
});

describe('<RoomClient /> joining', () => {
  const readyProfile: ProfileState = {
    status: 'ready',
    profile: { id: 'g', nickname: 'Khách', avatarSeed: 's' },
    error: null,
    save: async () => null,
  };

  beforeEach(() => {
    profileState = readyProfile;
  });

  for (const [code, message] of [
    ['ROOM_FULL', 'Phòng đã đủ 10 người.'],
    ['LATE_JOIN_CLOSED', 'Ván đang diễn ra và chủ phòng không cho vào giữa ván. Hãy chờ ván sau.'],
  ] as const) {
    it(`${code} shows a Vietnamese error message`, async () => {
      roomState = {
        snapshot: snapshot({ isMember: false, viewerId: 'g', players: [player('h', { isHost: true })] }),
        error: null,
        send: vi.fn(async (cmd: RoomCommand) =>
          cmd.type === 'join' ? { ok: false as const, error: code } : { ok: true as const },
        ),
      };
      render(<RoomClient code="12345" />);
      await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message));
      expect(roomState.send).toHaveBeenCalledWith({ type: 'join' });
    });
  }

  it('a missing or closed room shows a not-found message', () => {
    roomState = { snapshot: null, error: 'ROOM_NOT_FOUND', send: vi.fn() };
    render(<RoomClient code="12345" />);
    expect(screen.getByRole('alert').textContent).toBe('Không tìm thấy phòng, hoặc phòng đã đóng.');
  });

  it('asks for a profile before joining', () => {
    profileState = { status: 'needs-profile', profile: null, error: null, save: async () => null };
    roomState = { snapshot: null, error: null, send: vi.fn() };
    render(<RoomClient code="12345" />);
    expect(screen.getByLabelText('Biệt danh')).toBeTruthy();
    expect(roomState.send).not.toHaveBeenCalled();
  });
});
