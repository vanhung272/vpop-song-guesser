import type { RoomSettings } from '@/lib/rooms/state-machine';
import { badBody, isPlainObject, readJson, roomRoute } from '@/lib/rooms/route-helpers';

/**
 * PATCH /api/rooms/:code/settings Partial<RoomSettings> -> { version, changed }.
 * Unknown keys or values outside the allowed options -> 409 INVALID_SETTINGS (state machine).
 */
export const PATCH = roomRoute(async (svc, code, userId, request) => {
  const body = await readJson(request);
  if (!isPlainObject(body)) return badBody();
  return svc.updateSettings(code, userId, body as Partial<RoomSettings>);
}, { withSnapshot: true });
