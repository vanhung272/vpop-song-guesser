import { roomRoute } from '@/lib/rooms/route-helpers';

/** POST /api/rooms/:code/leave -> { version, changed }. */
export const POST = roomRoute((svc, code, userId) => svc.leave(code, userId));
