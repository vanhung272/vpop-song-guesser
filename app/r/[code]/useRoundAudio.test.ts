// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRoundAudio } from './useRoundAudio';

/** Minimal fake media element: records src/currentTime/play/pause and lets tests fire events. */
class FakeAudio extends EventTarget {
  src = '';
  preload = '';
  currentTime = 0;
  volume = 1;
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

  it('plays without any click when the browser allows it (sound is on by default)', () => {
    const { result } = mount('https://a/1.m4a', null);
    expect(result.current.unlocked).toBe(true);
    act(() => result.current.playAt(now));
    expect(player().play).toHaveBeenCalledTimes(1);
  });

  it('when the browser blocks playback, it reports locked until the user clicks', async () => {
    const { result } = mount('https://a/1.m4a', null);
    player().play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    await act(async () => result.current.playAt(now));
    expect(result.current.unlocked).toBe(false);
    await act(async () => {
      await result.current.unlock();
    });
    expect(result.current.unlocked).toBe(true);
  });

  it('other playback errors (e.g. a source swap aborting play) do not lock audio', async () => {
    const { result } = mount('https://a/1.m4a', null);
    player().play.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await act(async () => result.current.playAt(now));
    expect(result.current.unlocked).toBe(true);
  });

  it('the first click anywhere on the page unlocks the playback element', async () => {
    mount('https://a/1.m4a', null);
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(player().play).toHaveBeenCalledTimes(1);
    expect(player().pause).toHaveBeenCalled();
  });

  it('a click while the clip plays does not interrupt it', async () => {
    const { result } = mount('https://a/1.m4a', null);
    act(() => result.current.playAt(now));
    await act(async () => {});
    player().pause.mockClear();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(player().pause).not.toHaveBeenCalled();
    expect(player().paused).toBe(false);
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

  it('fadeOut lowers the volume step by step, then pauses and restores it for the next clip', () => {
    const { result } = mount('https://a/1.m4a', null);
    act(() => result.current.playAt(now));
    act(() => result.current.fadeOut(1000));
    vi.advanceTimersByTime(500);
    expect(player().volume).toBeGreaterThan(0.3);
    expect(player().volume).toBeLessThan(0.7);
    expect(player().paused).toBe(false);
    vi.advanceTimersByTime(600);
    expect(player().paused).toBe(true);
    expect(player().volume).toBe(1);
  });

  it('fadeOut can wait first: plays on at full volume, then fades out over the last part', () => {
    const { result } = mount('https://a/1.m4a', null);
    act(() => result.current.playAt(now));
    act(() => result.current.fadeOut(1000, 2000));
    vi.advanceTimersByTime(1900);
    expect(player().volume).toBe(1);
    expect(player().paused).toBe(false);
    vi.advanceTimersByTime(600); // 2.5 s: half way through the fade
    expect(player().volume).toBeGreaterThan(0.3);
    expect(player().volume).toBeLessThan(0.7);
    vi.advanceTimersByTime(600); // 3.1 s: done
    expect(player().paused).toBe(true);
    expect(player().volume).toBe(1);
  });

  it('a new clip after a fade plays at full volume, and stop cancels a fade', () => {
    const { result } = mount('https://a/1.m4a', null);
    act(() => result.current.playAt(now));
    act(() => result.current.fadeOut(1000));
    vi.advanceTimersByTime(400);
    act(() => result.current.playAt(now));
    expect(player().volume).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(player().paused).toBe(false); // the cancelled fade does not pause the new clip
    act(() => result.current.fadeOut(1000));
    act(() => result.current.stop());
    expect(player().paused).toBe(true);
    expect(player().volume).toBe(1);
  });

  it('switching to the next clip reuses the playback element', () => {
    const { rerender } = mount('https://a/1.m4a', 'https://a/2.m4a');
    rerender({ c: 'https://a/2.m4a', n: 'https://a/3.m4a' });
    expect(player().src).toBe('https://a/2.m4a');
    expect(player().pause).toHaveBeenCalled();
  });
});
