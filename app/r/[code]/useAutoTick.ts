'use client';

import { useEffect } from 'react';
import type { RoomSnapshot } from '@/lib/rooms/snapshot';
import type { RoomCommand, SendResult } from './useRoom';

/** Spread of the random delay added to each client's tick so they don't all hit at once. */
export const TICK_JITTER_MS = 300;
/** If the phase still hasn't changed this long after a tick, tick again (a tick can lose a race). */
export const TICK_RETRY_MS = 2000;

/**
 * Every client asks the server to advance the phase once its deadline passes (server clock),
 * plus 0-300 ms of jitter. The server advances at most once per deadline (version check).
 */
export function useAutoTick(
  snapshot: Pick<RoomSnapshot, 'version' | 'phase' | 'phaseEndsAt'>,
  nowMs: () => number,
  send: (cmd: RoomCommand) => Promise<SendResult>,
): void {
  const { version, phaseEndsAt } = snapshot;
  useEffect(() => {
    if (phaseEndsAt == null) return;
    let timer: ReturnType<typeof setTimeout>;
    const fire = () => {
      void send({ type: 'tick' });
      timer = setTimeout(fire, TICK_RETRY_MS);
    };
    const wait = Math.max(0, phaseEndsAt - nowMs()) + Math.random() * TICK_JITTER_MS;
    timer = setTimeout(fire, wait);
    return () => clearTimeout(timer);
  }, [version, phaseEndsAt, nowMs, send]);
}
