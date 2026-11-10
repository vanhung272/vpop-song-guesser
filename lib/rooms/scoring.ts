/** Points for a question in round `roundNumber` (1-based). */
export function pointsOnOffer(roundNumber: number): {
  base: number;
  maxBonus: number;
} {
  const step = roundNumber - 1;
  return { base: 500 + 50 * step, maxBonus: 300 + 50 * step };
}

/**
 * Score for one answer. Wrong or timed-out answers score 0; correct answers
 * score `base` plus a bonus that scales linearly with the time remaining.
 */
export function pointsFor(
  roundNumber: number,
  correct: boolean,
  remainingMs: number,
  limitMs: number,
): number {
  if (!correct) return 0;
  const { base, maxBonus } = pointsOnOffer(roundNumber);
  if (!(limitMs > 0)) return base;
  const remaining = Math.min(Math.max(remainingMs, 0), limitMs);
  return base + Math.round((maxBonus * remaining) / limitMs);
}
