import { roomRoute } from '@/lib/rooms/route-helpers';

/** POST /api/rooms/:code/start -> { version, changed }. */
export const POST = roomRoute((svc, code, userId) => svc.start(code, userId));
