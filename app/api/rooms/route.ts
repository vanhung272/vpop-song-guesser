import { roomsRoute } from '@/lib/rooms/route-helpers';

/** POST /api/rooms -> 201 { code }. The caller becomes host and first player. */
export const POST = roomsRoute((svc, userId) => svc.createRoom(userId), 201);
