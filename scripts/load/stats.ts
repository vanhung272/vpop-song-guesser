export interface Sample {
  endpoint: string;
  ms: number;
  status: number;
  error?: string;
}

export interface EndpointSummary {
  endpoint: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  errors: Record<string, number>;
}

/** Nearest-rank percentile of `xs` (0 for an empty list). */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(samples: Sample[]): EndpointSummary[] {
  const by = new Map<string, Sample[]>();
  for (const s of samples) by.set(s.endpoint, [...(by.get(s.endpoint) ?? []), s]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([endpoint, list]) => {
      const ms = list.map((s) => s.ms);
      const errors: Record<string, number> = {};
      for (const s of list) if (s.error) errors[s.error] = (errors[s.error] ?? 0) + 1;
      return { endpoint, count: list.length, p50: percentile(ms, 50), p95: percentile(ms, 95), max: Math.max(...ms), errors };
    });
}

/** Phase changes in one game of `questions` rounds (see the room flow in the plan). */
export const expectedTransitions = (questions: number) => 1 + 3 * questions;

/**
 * Calls that mean the backend failed under load: 5xx, no response, or a save that ran out of
 * retries (CONFLICT). TOO_LATE / WRONG_PHASE are normal game outcomes and do not count.
 */
export const failedCalls = (samples: Sample[]) =>
  samples.filter((s) => s.status === 0 || s.status >= 500 || s.error === 'CONFLICT').length;
