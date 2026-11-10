import { badBody, isPlainObject, readJson, roomRoute } from '@/lib/rooms/route-helpers';

/** POST /api/rooms/:code/answer { answerId } -> { version, changed }. Scored at server receive time. */
export const POST = roomRoute(async (svc, code, userId, request) => {
  const body = await readJson(request);
  if (!isPlainObject(body) || typeof body.answerId !== 'string' || body.answerId === '' || body.answerId.length > 100) {
    return badBody();
  }
  return svc.answer(code, userId, body.answerId);
});
