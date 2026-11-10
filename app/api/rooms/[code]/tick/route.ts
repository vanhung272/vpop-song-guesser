import { roomRoute } from '@/lib/rooms/route-helpers';

/** POST /api/rooms/:code/tick -> { version, changed }. */
export const POST = roomRoute((svc, code, userId) => svc.tick(code, userId));
