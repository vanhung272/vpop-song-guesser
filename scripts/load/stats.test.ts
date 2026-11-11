import { describe, expect, it } from 'vitest';
import { expectedTransitions, percentile, summarize } from './stats';

describe('load stats', () => {
  it('percentile uses nearest rank', () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile([], 50)).toBe(0);
  });

  it('summarize groups samples by endpoint and counts errors', () => {
    const rows = summarize([
      { endpoint: 'GET snapshot', ms: 40, status: 200 },
      { endpoint: 'GET snapshot', ms: 60, status: 200 },
      { endpoint: 'POST tick', ms: 90, status: 409, error: 'CONFLICT' },
    ]);
    expect(rows).toEqual([
      { endpoint: 'GET snapshot', count: 2, p50: 40, p95: 60, max: 60, errors: {} },
      { endpoint: 'POST tick', count: 1, p50: 90, p95: 90, max: 90, errors: { CONFLICT: 1 } },
    ]);
  });

  it('a game of n questions has 1 + 3n phase transitions', () => {
    // countdown->presenting, then per round presenting->question, question->reveal, reveal->next|results.
    expect(expectedTransitions(5)).toBe(16);
  });
});
