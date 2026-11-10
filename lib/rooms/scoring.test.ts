import { describe, expect, it } from 'vitest';
import { pointsFor, pointsOnOffer } from './scoring';

describe('pointsFor', () => {
  it('wrong is 0', () => {
    expect(pointsFor(1, false, 15000, 15000)).toBe(0);
    expect(pointsFor(5, false, 0, 15000)).toBe(0);
  });

  it('round 1 instant correct is 800', () => {
    expect(pointsFor(1, true, 15000, 15000)).toBe(800);
  });

  it('round 1 correct with 0ms left is 500', () => {
    expect(pointsFor(1, true, 0, 15000)).toBe(500);
  });

  it('round 3 instant correct is 1000', () => {
    expect(pointsFor(3, true, 10000, 10000)).toBe(1000);
  });

  it('round 1 half time left is 650', () => {
    expect(pointsFor(1, true, 7500, 15000)).toBe(650);
  });

  it('clamps remainingMs to [0, limitMs]', () => {
    expect(pointsFor(1, true, -500, 15000)).toBe(500);
    expect(pointsFor(1, true, 99999, 15000)).toBe(800);
  });

  it('faster never scores less than slower', () => {
    for (const n of [1, 2, 7, 15]) {
      let prev = -1;
      for (let remaining = 0; remaining <= 15000; remaining += 137) {
        const pts = pointsFor(n, true, remaining, 15000);
        expect(pts).toBeGreaterThanOrEqual(prev);
        prev = pts;
      }
    }
  });
});

describe('pointsOnOffer', () => {
  it('returns base and maxBonus for the round', () => {
    expect(pointsOnOffer(1)).toEqual({ base: 500, maxBonus: 300 });
    expect(pointsOnOffer(3)).toEqual({ base: 600, maxBonus: 400 });
  });
});
