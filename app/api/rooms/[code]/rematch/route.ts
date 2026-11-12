import { roomRoute } from '@/lib/rooms/route-helpers';

/** POST /api/rooms/:code/rematch -> { version, changed }. */
export const POST = roomRoute((svc, code, userId) => svc.rematch(code, userId), { withSnapshot: true });
