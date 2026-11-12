'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { HEARTBEAT_MS } from '@/lib/rooms/config';
import { ROOM_CHANGED_EVENT, roomChannel } from '@/lib/rooms/notify';
import type { ThemeRef } from '@/lib/rooms/round-builder';
import type { RoomSnapshot } from '@/lib/rooms/snapshot';
import type { RoomSettings } from '@/lib/rooms/state-machine';
import { createClient } from '@/lib/supabase/client';

export type RoomCommand =
  | { type: 'join' }
  | { type: 'leave' }
  | { type: 'heartbeat' }
  | { type: 'start' }
  | { type: 'tick' }
  | { type: 'rematch' }
  | { type: 'settings'; patch: Partial<RoomSettings> }
  | { type: 'theme'; theme: ThemeRef }
  | { type: 'answer'; answerId: string };

export type SendResult = { ok: true } | { ok: false; error: string };

export interface UseRoomResult {
  snapshot: RoomSnapshot | null;
  /** Error code of the last failed snapshot fetch (e.g. ROOM_NOT_FOUND); null once one succeeds. */
  error: string | null;
  send: (cmd: RoomCommand) => Promise<SendResult>;
}

function request(cmd: RoomCommand): { path: string; method: 'POST' | 'PATCH'; body?: unknown } {
  switch (cmd.type) {
    case 'settings':
      return { path: 'settings', method: 'PATCH', body: cmd.patch };
    case 'theme':
      return { path: 'theme', method: 'PATCH', body: cmd.theme };
    case 'answer':
      return { path: 'answer', method: 'POST', body: { answerId: cmd.answerId } };
    default:
      return { path: cmd.type, method: 'POST' };
  }
}

/**
 * Live room state. The API snapshot is the single source of truth; the Realtime broadcast only
 * carries `{version}` and triggers a refetch when it is newer than what we hold.
 */
export function useRoom(code: string, { enabled = true }: { enabled?: boolean } = {}): UseRoomResult {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(-1);
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const base = `/api/rooms/${code}`;

  /** Keeps the newest snapshot; responses can arrive out of order, so never go back a version. */
  const accept = useCallback((next: RoomSnapshot) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const refetch = useCallback(async () => {
    // Coalesce: while a fetch is running, remember to fetch once more when it ends.
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        const res = await apiFetch<RoomSnapshot>(base);
        if (res.ok) {
          accept(res.data);
          setError(null);
        } else if (res.error !== 'NETWORK') {
          setError(res.error);
        }
      } while (again.current);
    } finally {
      inFlight.current = false;
    }
  }, [base, accept]);

  const send = useCallback(
    async (cmd: RoomCommand): Promise<SendResult> => {
      const { path, method, body } = request(cmd);
      const res = await apiFetch<{ version?: number; snapshot?: RoomSnapshot }>(`${base}/${path}`, {
        method,
        body,
      });
      if (!res.ok) return { ok: false, error: res.error };
      // Most commands answer with the caller's new snapshot: show it now, no second round trip.
      if (res.data?.snapshot) accept(res.data.snapshot);
      else if (typeof res.data?.version === 'number' && res.data.version > versionRef.current) void refetch();
      return { ok: true };
    },
    [base, refetch, accept],
  );

  // Realtime subscription + initial load (SUBSCRIBED fires again after a reconnect).
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    const channel = supabase
      .channel(roomChannel(code))
      .on('broadcast', { event: ROOM_CHANGED_EVENT }, (msg: { payload: unknown }) => {
        const version = (msg.payload as { version?: unknown } | null)?.version;
        if (typeof version === 'number' && version > versionRef.current) void refetch();
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') void refetch();
      });
    void refetch();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [code, enabled, refetch]);

  // Heartbeat while a member; refetch when the tab becomes visible again.
  const isMember = snapshot?.isMember ?? false;
  useEffect(() => {
    if (!enabled || !isMember) return;
    const beat = () => void send({ type: 'heartbeat' });
    const timer = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        beat();
        void refetch();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, isMember, send, refetch]);

  // Free the slot when a non-host closes the tab (R7e). The host is not sent away: a reload must not
  // hand the room to someone else; if the host is really gone, offline detection transfers it.
  useEffect(() => {
    if (!enabled || !isMember) return;
    const onPageHide = () => {
      if (!snapshotRef.current?.isHost) navigator.sendBeacon?.(`${base}/leave`);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [enabled, isMember, base]);

  return { snapshot, error, send };
}
