// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { ServerClock, useServerClock } from './useServerClock';

const SERVER = 1_700_000_000_000;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ServerClock', () => {
  it('maps client time to server time with the observed offset', () => {
    const c = new ServerClock();
    c.observe(SERVER, SERVER + 300_000); // client 5 minutes ahead
    expect(c.now(SERVER + 300_000 + 1500)).toBe(SERVER + 1500);
  });

  it('keeps the largest recent offset (the sample with the least network delay)', () => {
    const c = new ServerClock();
    c.observe(SERVER, SERVER + 80); // arrived 80 ms after the server built it
    c.observe(SERVER + 1000, SERVER + 1010); // 10 ms
    c.observe(SERVER + 2000, SERVER + 2200); // 200 ms
    expect(c.now(SERVER + 3000)).toBe(SERVER + 2990);
  });

  it('forgets old samples so a changed client clock is picked up', () => {
    const c = new ServerClock(3);
    c.observe(SERVER, SERVER); // offset 0
    for (let i = 1; i <= 3; i++) c.observe(SERVER + i, SERVER + i + 60_000); // client jumped 1 min ahead
    expect(c.now(SERVER + 60_010)).toBe(SERVER + 10);
  });

  it('without samples returns the client time', () => {
    expect(new ServerClock().now(123)).toBe(123);
  });
});

describe('useServerClock', () => {
  it('nowMs follows the server clock even when the client clock is 5 minutes ahead', () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER + 300_000);
    const { result, rerender } = renderHook(({ s }) => useServerClock(s), { initialProps: { s: SERVER } });
    expect(result.current.nowMs()).toBe(SERVER);
    vi.advanceTimersByTime(2000);
    expect(result.current.nowMs()).toBe(SERVER + 2000);
    rerender({ s: SERVER + 2000 });
    expect(result.current.nowMs()).toBe(SERVER + 2000);
  });
});
