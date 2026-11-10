import { roomRoute } from '@/lib/rooms/route-helpers';

/** POST /api/rooms/:code/heartbeat -> { version, changed }. */
export const POST = roomRoute((svc, code, userId) => svc.heartbeat(code, userId));
