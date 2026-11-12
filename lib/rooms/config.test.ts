import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS, PRESENT_MS, REVEAL_MS, timingScale } from './config';

describe('timingScale (R11a)', () => {
  it('is 1 by default', () => {
    expect(timingScale({})).toBe(1);
    expect(timingScale({ NODE_ENV: 'development' })).toBe(1);
  });

  it('honours ROOM_TIMING_SCALE only for E2E=1 or NODE_ENV=test', () => {
    expect(timingScale({ E2E: '1', NODE_ENV: 'development', ROOM_TIMING_SCALE: '0.5' })).toBe(0.5);
    expect(timingScale({ NODE_ENV: 'test', ROOM_TIMING_SCALE: '0.2' })).toBe(0.2);
    expect(timingScale({ NODE_ENV: 'development', ROOM_TIMING_SCALE: '0.5' })).toBe(1);
  });

  it('is never applied in production', () => {
    expect(timingScale({ E2E: '1', NODE_ENV: 'production', ROOM_TIMING_SCALE: '0.5' })).toBe(1);
  });

  it('ignores invalid values', () => {
    for (const v of ['0', '-1', '2', 'abc', '']) {
      expect(timingScale({ E2E: '1', ROOM_TIMING_SCALE: v })).toBe(1);
    }
  });
});

describe('phase durations (unscaled in unit tests)', () => {
  it('countdown 3 s, round card 1.5 s, reveal 6 s', () => {
    expect([COUNTDOWN_MS, PRESENT_MS, REVEAL_MS]).toEqual([3000, 1500, 6000]);
  });
});
