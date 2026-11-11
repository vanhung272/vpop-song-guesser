// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRoundAudio } from './useRoundAudio';

/** Minimal fake media element: records src/currentTime/play/pause and lets tests fire events. */
class FakeAudio extends EventTarget {
  src = '';
  preload = '';
  currentTime = 0;
  paused = true;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
}

let created: FakeAudio[];
let now: number;
const createAudio = () => {
  const a = new FakeAudio();
  created.push(a);
  return a as unknown as HTMLAudioElement;
};

beforeEach(() => {
  created = [];
  now = 1000;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(current: string | null, next: string | null) {
  return renderHook(
    ({ c, n }) => useRoundAudio(c, n, { nowMs: () => now, createAudio }),
    { initialProps: { c: current, n: next } },
  );
}

const player = () => created[0];

describe('useRoundAudio', () => {
  it('loads the current clip and preloads the next one', () => {
    mount('https://a/1.m4a', 'https://a/2.m4a');
    expect(player().src).toBe('https://a/1.m4a');
    const preloader = created.find((a) => a !== player())!;
    expect(preloader.src).toBe('https://a/2.m4a');
    expect(preloader.preload).toBe('auto');
    expect(preloader.play).not.toHaveBeenCalled();
  });

  it('becomes ready on canplaythrough and failed on error', () => {
    const { result } = mount('https://a/1.m4a', null);
    expect(result.current.ready).toBe(false);
    act(() => {
      player().dispatchEvent(new Event('canplaythrough'));
    });
    expect(result.current.ready).toBe(true);
    act(() => {
      player().dispatchEvent(new Event('error'));
    });
    expect(result.current.failed).toBe(true);
  });

  it('a missing url counts as failed', () => {
    const { result } = mount(null, null);
    expect(result.current.failed).toBe(true);
  });

  it('does not play before the user unlocked audio with a click', () => {
    const { result } = mount('https://a/1.m4a', null);
    act(() => result.current.playAt(now));
    vi.advanceTimersByTime(100);
    expect(player().play).not.toHaveBeenCalled();
    expect(result.current.unlocked).toBe(false);
  });

  it('unlock plays inside the click gesture, then playAt starts on time', async () => {
    const { result } = mount('https://a/1.m4a', null);
    await act(async () => {
      await result.current.unlock();
    });
    expect(result.current.unlocked).toBe(true);
    expect(player().pause).toHaveBeenCalled();
    player().play.mockClear();

    act(() => result.current.playAt(now + 500));
    vi.advanceTimersByTime(499);
    expect(player().play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(player().play).toHaveBeenCalledTimes(1);
    expect(player().currentTime).toBe(0);
  });

  it('playAt after the start time seeks into the clip', async () => {
    const { result } = mount('https://a/1.m4a', null);
    await act(async () => {
      await result.current.unlock();
    });
    player().play.mockClear();
    act(() => result.current.playAt(now - 2500));
    expect(player().currentTime).toBe(2.5);
    expect(player().play).toHaveBeenCalledTimes(1);
  });

  it('switching to the next clip reuses the playback element', () => {
    const { rerender } = mount('https://a/1.m4a', 'https://a/2.m4a');
    rerender({ c: 'https://a/2.m4a', n: 'https://a/3.m4a' });
    expect(player().src).toBe('https://a/2.m4a');
    expect(player().pause).toHaveBeenCalled();
  });
});
