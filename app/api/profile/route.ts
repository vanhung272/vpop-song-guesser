import { NextResponse } from 'next/server';
import { SEED_RE } from '@/lib/avatar/avatar-spec';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { errorResponse, isPlainObject, readJson } from '@/lib/rooms/route-helpers';

const NICKNAME_MAX = 30;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

/** Trimmed, NFC-normalized nickname of 1..30 code points (matches the DB check), else null. */
function parseNickname(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const nickname = v.normalize('NFC').trim();
  const length = [...nickname].length;
  if (length < 1 || length > NICKNAME_MAX || CONTROL_RE.test(nickname)) return null;
  return nickname;
}

/**
 * POST /api/profile {nickname, avatarSeed} -> {id, nickname, avatarSeed}
 * Creates or updates the guest profile of the current (anonymous) Supabase session.
 * Only the avatar seed is stored; clients redraw the avatar from it.
 */
export async function POST(request: Request) {
  try {
    const session = await createClient();
    const { data, error } = await session.auth.getUser();
    if (error || !data.user) return errorResponse(401, 'UNAUTHENTICATED');

    const body = await readJson(request);
    if (!isPlainObject(body)) return errorResponse(400, 'INVALID_BODY');
    const nickname = parseNickname(body.nickname);
    if (nickname === null) return errorResponse(400, 'INVALID_NICKNAME');
    const avatarSeed = body.avatarSeed;
    if (typeof avatarSeed !== 'string' || !SEED_RE.test(avatarSeed)) {
      return errorResponse(400, 'INVALID_AVATAR_SEED');
    }

    const id = data.user.id;
    const { error: upsertError } = await createAdminClient()
      .from('profiles')
      .upsert({ id, nickname, avatar_seed: avatarSeed }, { onConflict: 'id' });
    if (upsertError) throw new Error(`profile upsert: ${upsertError.message}`);

    return NextResponse.json({ id, nickname, avatarSeed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('profile route failed:', err);
    return errorResponse(500, 'INTERNAL');
  }
}
