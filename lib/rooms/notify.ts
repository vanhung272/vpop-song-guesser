import type { SupabaseClient } from '@supabase/supabase-js';

/** Broadcast channel and event a room's clients subscribe to. */
export const roomChannel = (code: string) => `room:${code}`;
export const ROOM_CHANGED_EVENT = 'changed';

/** `notifyRoomChanged(code, version)`: tells subscribers to refetch their snapshot. */
export type NotifyRoomChanged = (code: string, version: number) => Promise<void>;

/**
 * Realtime Broadcast over the REST endpoint (no socket held open, fits serverless). The payload is
 * `{ version }` and nothing else: a forged broadcast can only cause one extra snapshot fetch.
 * Pass the service-role client (server only).
 */
export function createRoomNotifier(db: SupabaseClient): NotifyRoomChanged {
  return async (code, version) => {
    const channel = db.channel(roomChannel(code));
    try {
      const res = await channel.httpSend(ROOM_CHANGED_EVENT, { version });
      if (!res.success) throw new Error(`broadcast failed: ${res.status} ${res.error}`);
    } finally {
      await db.removeChannel(channel);
    }
  };
}
