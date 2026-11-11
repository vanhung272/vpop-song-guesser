'use client';

import { useCallback, useState } from 'react';

/**
 * Estimates server time from snapshot timestamps. Each sample's offset (serverNow - clientReceive)
 * undershoots the true offset by the network delay, so the largest recent offset is the best
 * estimate. Only the last `window` samples count, so a client clock change is picked up.
 */
export class ServerClock {
  private samples: number[] = [];

  constructor(private readonly window = 8) {}

  observe(serverNowMs: number, clientNowMs: number): void {
    this.samples.push(serverNowMs - clientNowMs);
    if (this.samples.length > this.window) this.samples.shift();
  }

  now(clientNowMs: number): number {
    return this.samples.length === 0 ? clientNowMs : clientNowMs + Math.max(...this.samples);
  }
}

const clientNow = () => Date.now();

/** `nowMs()` = current server time (epoch ms), corrected for the client clock's skew. */
export function useServerClock(serverNowMs: number | null | undefined): { nowMs: () => number } {
  const [clock] = useState(() => new ServerClock());
  const [observed, setObserved] = useState<number | null>(null);
  // "Adjust state when a prop changes" during render, so the very first frame of a new snapshot
  // already uses the corrected clock (an effect would paint one frame with the raw client clock).
  if (serverNowMs != null && serverNowMs !== observed) {
    setObserved(serverNowMs);
    clock.observe(serverNowMs, clientNow());
  }
  const nowMs = useCallback(() => clock.now(clientNow()), [clock]);
  return { nowMs };
}
