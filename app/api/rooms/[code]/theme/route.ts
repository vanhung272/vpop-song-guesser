import { THEME_TYPES, type ThemeType } from '@/lib/themes/themes';
import { badBody, isPlainObject, readJson, roomRoute } from '@/lib/rooms/route-helpers';

/** PATCH /api/rooms/:code/theme { type, key } -> { version, changed }; unplayable -> 409 THEME_NOT_PLAYABLE. */
export const PATCH = roomRoute(async (svc, code, userId, request) => {
  const body = await readJson(request);
  if (
    !isPlainObject(body) ||
    typeof body.type !== 'string' ||
    !(THEME_TYPES as readonly string[]).includes(body.type) ||
    typeof body.key !== 'string' ||
    body.key === '' ||
    body.key.length > 2000 // a mix lists up to MIX_MAX_PARTS themes
  ) {
    return badBody();
  }
  return svc.updateTheme(code, userId, { type: body.type as ThemeType, key: body.key });
});
