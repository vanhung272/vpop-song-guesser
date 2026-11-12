import { roomRoute } from '@/lib/rooms/route-helpers';

/** POST /api/rooms/:code/join -> { version, changed }. */
export const POST = roomRoute((svc, code, userId) => svc.join(code, userId), { withSnapshot: true });
