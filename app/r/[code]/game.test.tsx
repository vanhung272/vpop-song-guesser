// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RoomSnapshot } from '@/lib/rooms/snapshot';
import type { RoundAudio } from './useRoundAudio';
import type { RoomCommand, SendResult } from './useRoom';
import { T0, player, round, snapshot } from './test-fixtures';

let audio: RoundAudio;
vi.mock('./useRoundAudio', () => ({ useRoundAudio: () => audio }));

import { Game } from './Game';

let send: ReturnType<typeof vi.fn<(cmd: RoomCommand) => Promise<SendResult>>>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  send = vi.fn(async () => ({ ok: true as const }));
  audio = {
    unlocked: true,
    ready: true,
    failed: false,
    unlock: vi.fn(async () => {}),
    playAt: vi.fn(),
    stop: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ticks = () => send.mock.calls.filter(([c]) => c.type === 'tick').length;
const choiceButtons = () =>
  ['Bài Một', 'Bài Hai', 'Bài Ba', 'Bài Bốn'].map((l) => screen.getByRole('button', { name: new RegExp(l) }));

describe('<Game />', () => {
  it('audio needs one user click before the first question', () => {
    audio.unlocked = false;
    const s = snapshot();
    const { rerender } = render(<Game snapshot={s} send={send} />);
    expect(audio.playAt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Bật âm thanh' }));
    expect(audio.unlock).toHaveBeenCalledTimes(1);

    audio = { ...audio, unlocked: true };
    rerender(<Game snapshot={{ ...s }} send={send} />);
    expect(screen.queryByRole('button', { name: 'Bật âm thanh' })).toBeNull();
    // Question started at phaseEndsAt - timeLimitMs (server time).
    expect(audio.playAt).toHaveBeenCalledWith(T0 + 10_000 - 15_000);
  });

  it('timer uses server offset: with client clock 5 minutes ahead it still shows the correct remaining time', () => {
    vi.setSystemTime(T0 + 5 * 60_000);
    render(<Game snapshot={snapshot({ serverNowMs: T0, phaseEndsAt: T0 + 10_000 })} send={send} />);
    expect(screen.getByLabelText('Thời gian còn lại').textContent).toBe('10');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByLabelText('Thời gian còn lại').textContent).toBe('7');
  });

  it('choices lock after one answer and show "Bạn đã chọn"', async () => {
    render(<Game snapshot={snapshot()} send={send} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Bài Hai/ }));
    });
    expect(send).toHaveBeenCalledWith({ type: 'answer', answerId: 'a2' });
    for (const b of choiceButtons()) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Bài Hai/ }).textContent).toContain('Bạn đã chọn');
    fireEvent.click(screen.getByRole('button', { name: /Bài Ba/ }));
    expect(send.mock.calls.filter(([c]) => c.type === 'answer')).toHaveLength(1);
  });

  it('an answer already in the snapshot keeps the choices locked', () => {
    render(
      <Game snapshot={snapshot({ round: round({ myAnswer: { answerId: 'a3', points: null, correct: null } }) })} send={send} />,
    );
    for (const b of choiceButtons()) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Bài Ba/ }).textContent).toContain('Bạn đã chọn');
  });

  it('a late joiner sees the current round as spectator and can answer from the next round', () => {
    const late = snapshot({
      roundIdx: 2,
      players: [player('h', { isHost: true }), player('g', { joinedRound: 3 })],
      round: round({ idx: 2, roundNumber: 3, canAnswer: false }),
    });
    const { rerender } = render(<Game snapshot={late} send={send} />);
    expect(screen.getByText('Bạn vào giữa vòng này, hãy trả lời từ vòng sau nhé.')).toBeTruthy();
    for (const b of choiceButtons()) expect((b as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <Game
        snapshot={{ ...late, version: 12, roundIdx: 3, round: round({ idx: 3, roundNumber: 4, canAnswer: true }) }}
        send={send}
      />,
    );
    expect(screen.queryByText('Bạn vào giữa vòng này, hãy trả lời từ vòng sau nhé.')).toBeNull();
    for (const b of choiceButtons()) expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it('when audio fails the player sees a message and can still answer', () => {
    audio.failed = true;
    audio.ready = false;
    render(<Game snapshot={snapshot()} send={send} />);
    expect(screen.getByText('Không tải được đoạn nhạc này. Bạn vẫn có thể đoán!')).toBeTruthy();
    for (const b of choiceButtons()) expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows live answer percentages when the room enables them', () => {
    render(
      <Game snapshot={snapshot({ round: round({ livePercentages: { a1: 25, a2: 75, a3: 0, a4: 0 } }) })} send={send} />,
    );
    expect(screen.getByRole('button', { name: /Bài Hai/ }).textContent).toContain('75%');
  });

  it('reveal shows title, artist, cover, top 3 and own points', () => {
    const s = snapshot({
      phase: 'reveal',
      phaseEndsAt: T0 + 6000,
      round: round({
        myAnswer: { answerId: 'a2', points: 750, correct: true },
        reveal: {
          correctAnswerId: 'a2',
          track: { title: 'Bài Hai', artist: 'Ca Sĩ X', coverUrl: 'https://img.test/c.jpg' },
          top3: [
            { playerId: 'g', nickname: 'Khách', points: 750 },
            { playerId: 'h', nickname: 'Bảo', points: 610 },
          ],
        },
      }),
    });
    render(<Game snapshot={s} send={send} />);
    const reveal = screen.getByRole('region', { name: 'Đáp án' });
    expect(reveal.textContent).toContain('Bài Hai');
    expect(reveal.textContent).toContain('Ca Sĩ X');
    expect((screen.getByRole('img', { name: 'Bìa bài Bài Hai' }) as HTMLImageElement).src).toBe('https://img.test/c.jpg');
    expect(reveal.textContent).toContain('+750 điểm');
    const top = screen.getByRole('list', { name: 'Top 3 vòng này' });
    expect(top.textContent).toContain('Khách');
    expect(top.textContent).toContain('Bảo');
  });

  it('reveal of a wrong answer shows 0 points', () => {
    const s = snapshot({
      phase: 'reveal',
      round: round({
        myAnswer: { answerId: 'a1', points: 0, correct: false },
        reveal: { correctAnswerId: 'a2', track: { title: 'Bài Hai', artist: 'Ca Sĩ X', coverUrl: null }, top3: [] },
      }),
    });
    render(<Game snapshot={s} send={send} />);
    expect(screen.getByRole('region', { name: 'Đáp án' }).textContent).toContain('0 điểm');
  });

  it('round card shows base and max bonus for that round', () => {
    render(
      <Game
        snapshot={snapshot({
          phase: 'presenting',
          phaseEndsAt: T0 + 3000,
          roundIdx: 2,
          round: round({ idx: 2, roundNumber: 3, choices: null, pointsOnOffer: { base: 600, maxBonus: 400 } }),
        })}
        send={send}
      />,
    );
    const card = screen.getByRole('region', { name: 'Vòng 3/5' });
    expect(card.textContent).toContain('Tối đa 1000 điểm');
    expect(card.textContent).toContain('600 điểm khi đúng');
    expect(card.textContent).toContain('+400 thưởng tốc độ');
    expect(card.textContent).toContain('Bài gì?');
  });

  it('countdown shows the seconds left', () => {
    render(<Game snapshot={snapshot({ phase: 'countdown', phaseEndsAt: T0 + 3000, round: null })} send={send} />);
    expect(screen.getByLabelText('Đếm ngược').textContent).toBe('3');
  });

  it('client calls tick once when the phase ends', () => {
    render(<Game snapshot={snapshot()} send={send} />);
    // Fires at phaseEndsAt + jitter (Math.random 0.5 -> 150 ms of 0-300).
    act(() => {
      vi.advanceTimersByTime(10_149);
    });
    expect(ticks()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(ticks()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(ticks()).toBe(1);
  });

  it('ticks again if the phase has still not advanced 2 s later', () => {
    render(<Game snapshot={snapshot()} send={send} />);
    act(() => {
      vi.advanceTimersByTime(10_150 + 2000);
    });
    expect(ticks()).toBe(2);
  });

  it('a new phase reschedules the tick for its own deadline', () => {
    const { rerender } = render(<Game snapshot={snapshot()} send={send} />);
    act(() => {
      vi.advanceTimersByTime(10_150);
    });
    expect(ticks()).toBe(1);
    rerender(<Game snapshot={snapshot({ version: 11, phase: 'reveal', serverNowMs: T0 + 10_200, phaseEndsAt: T0 + 16_200 })} send={send} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(ticks()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(5200);
    });
    expect(ticks()).toBe(2);
  });

  it('history tab lists revealed rounds with own result', () => {
    const s = snapshot({
      roundIdx: 1,
      round: round({ idx: 1, roundNumber: 2 }),
      history: [
        {
          idx: 0,
          roundNumber: 1,
          questionType: 'title',
          track: { title: 'Bài Cũ', artist: 'Ca Sĩ Y', coverUrl: null },
          correctLabel: 'Bài Cũ',
          myAnswerId: 'x',
          myPoints: 640,
          correct: true,
        },
      ],
    });
    render(<Game snapshot={s} send={send} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('Bài Cũ');
    expect(panel.textContent).toContain('+640');
  });
});

describe('<Game /> results', () => {
  const results = (overrides: Partial<RoomSnapshot> = {}) =>
    snapshot({
      phase: 'results',
      phaseEndsAt: null,
      round: null,
      players: [
        player('g', { nickname: 'Khách', score: 4200 }),
        player('h', { nickname: 'Bảo', score: 3100, isHost: true }),
        player('x', { nickname: 'Ba', score: 0 }),
      ],
      ...overrides,
    });

  it('results page shows the final ranking and copies share text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Game snapshot={results()} send={send} />);
    const ranking = screen.getByRole('list', { name: 'Xếp hạng chung cuộc' });
    const rows = ranking.querySelectorAll('li');
    expect(rows[0].textContent).toContain('Khách');
    expect(rows[0].textContent).toContain('4200');
    expect(rows[1].textContent).toContain('Bảo');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sao chép kết quả' }));
    });
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain('Đoán Nhanh V-pop');
    expect(text).toContain('Pop');
    expect(text).toContain('1. Khách 4200');
    expect(text).toContain('2. Bảo 3100');
    expect(text).toContain('Mình xếp hạng 1/3');
  });

  it('only the host sees the new game button', () => {
    const { rerender } = render(<Game snapshot={results()} send={send} />);
    expect(screen.queryByRole('button', { name: 'Ván mới' })).toBeNull();
    expect(screen.getByText('Chờ chủ phòng mở ván mới…')).toBeTruthy();
    rerender(<Game snapshot={results({ viewerId: 'h', isHost: true })} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ván mới' }));
    expect(send).toHaveBeenCalledWith({ type: 'rematch' });
  });

  it('results do not schedule ticks and stop the audio', () => {
    render(<Game snapshot={results()} send={send} />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(ticks()).toBe(0);
    expect(audio.stop).toHaveBeenCalled();
  });
});
