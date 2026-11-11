// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProfileState } from '@/lib/profile/useProfile';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let profileState: ProfileState;
vi.mock('@/lib/profile/useProfile', () => ({ useProfile: () => profileState }));

import { HomeClient } from './HomeClient';

const ready: ProfileState = {
  status: 'ready',
  profile: { id: 'u1', nickname: 'Hùng', avatarSeed: 'seed-1' },
  error: null,
  save: async () => null,
};

beforeEach(() => {
  push.mockReset();
  profileState = ready;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function joinWith(code: string) {
  fireEvent.change(screen.getByLabelText('Mã phòng'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Vào phòng' }));
}

describe('home page', () => {
  it('entering a 5-digit code navigates to /r/<code>', () => {
    render(<HomeClient />);
    joinWith('12345');
    expect(push).toHaveBeenCalledWith('/r/12345');
  });

  it('trims spaces around a pasted code', () => {
    render(<HomeClient />);
    joinWith(' 04321 ');
    expect(push).toHaveBeenCalledWith('/r/04321');
  });

  it('non-digit or wrong-length codes are rejected inline', () => {
    render(<HomeClient />);
    for (const bad of ['abc12', '1234', '123456', '12 34', '']) {
      joinWith(bad);
      expect(screen.getByRole('alert').textContent).toBe('Mã phòng gồm đúng 5 chữ số.');
    }
    expect(push).not.toHaveBeenCalled();
  });

  it('first visit asks for nickname and shows a random avatar', async () => {
    const save = vi.fn(async () => null);
    profileState = { status: 'needs-profile', profile: null, error: null, save };
    render(<HomeClient />);

    const nickname = screen.getByLabelText('Biệt danh') as HTMLInputElement;
    expect(nickname.value).toBe('');
    expect(screen.getByRole('img', { name: 'Ảnh đại diện' }).tagName).toBe('CANVAS');
    // Room actions wait until the profile exists.
    expect(screen.queryByRole('button', { name: 'Tạo phòng' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tên ngẫu nhiên' }));
    expect(nickname.value.length).toBeGreaterThan(0);

    fireEvent.change(nickname, { target: { value: 'Mèo Ú' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [savedName, savedSeed] = save.mock.calls[0] as unknown as [string, string];
    expect(savedName).toBe('Mèo Ú');
    expect(savedSeed).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('changing the avatar draws a new seed', async () => {
    const save = vi.fn(async () => null);
    profileState = { status: 'needs-profile', profile: null, error: null, save };
    render(<HomeClient />);
    fireEvent.change(screen.getByLabelText('Biệt danh'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đổi avatar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Đổi avatar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const seeds = save.mock.calls.map((c) => (c as unknown as [string, string])[1]);
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it('empty nickname is rejected before saving', () => {
    const save = vi.fn(async () => null);
    profileState = { status: 'needs-profile', profile: null, error: null, save };
    render(<HomeClient />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(screen.getByRole('alert').textContent).toBe('Biệt danh cần từ 1 đến 30 ký tự.');
    expect(save).not.toHaveBeenCalled();
  });
});
