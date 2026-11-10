import { roomRoute } from '@/lib/rooms/route-helpers';

/** GET /api/rooms/:code -> RoomSnapshot for the caller (members and non-members). */
export const GET = roomRoute((svc, code, userId) => svc.getSnapshot(code, userId));
