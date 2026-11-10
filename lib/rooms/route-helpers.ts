/**
 * Shared plumbing for app/api/rooms/** route handlers (server only: imports the admin client).
 * Handlers stay thin: auth + profile -> parse -> service -> map result.
 *
 *   401 { error: 'UNAUTHENTICATED' }   no Supabase session
 *   403 { error: 'PROFILE_REQUIRED' }  session but no profiles row
 *   404 { error: 'ROOM_NOT_FOUND' }    malformed code, missing or closed room
 *   400 { error: 'INVALID_BODY' | 'INVALID_ANSWER' }
 *   403 { error: 'NOT_IN_ROOM' }       command from a non-member
 *   409 { error: RoomError | 'THEME_NOT_PLAYABLE' | 'CONFLICT' }
 *   500 { error: 'INTERNAL' }
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { systemClock } from './clock';
import { ROOM_CODE_LENGTH } from './config';
import { createRoomNotifier } from './notify';
import { createRoomService, type RoomService, type ServiceResult } from './room-service';

export interface RoomRouteContext {
  params: Promise<{ code: string }>;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const CODE_RE = new RegExp(`^[0-9]{${ROOM_CODE_LENGTH}}$`);

export function errorResponse(status: number, error: string): Response {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export const badBody = () => errorResponse(400, 'INVALID_BODY');

function toResponse(result: ServiceResult<unknown>, okStatus = 200): Response {
  return result.ok
    ? NextResponse.json(result.data, { status: okStatus, headers: NO_STORE })
    : errorResponse(result.status, result.error);
}

/** Parsed JSON body, or undefined when missing / not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function authenticate(): Promise<{ userId: string; db: SupabaseClient } | Response> {
  const session = await createClient();
  const { data, error } = await session.auth.getUser();
  if (error || !data.user) return errorResponse(401, 'UNAUTHENTICATED');
  const db = createAdminClient();
  const profile = await db.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
  if (profile.error) throw new Error(`profile lookup: ${profile.error.message}`);
  if (!profile.data) return errorResponse(403, 'PROFILE_REQUIRED');
  return { userId: data.user.id, db };
}

function serviceFor(db: SupabaseClient): RoomService {
  return createRoomService({
    db,
    clock: systemClock,
    notify: createRoomNotifier(db),
    fetchFn: (url, init) => fetch(url, init),
    rng: Math.random,
  });
}

type Handler = (
  svc: RoomService,
  userId: string,
  request: Request,
) => Promise<ServiceResult<unknown> | Response>;

async function handle(request: Request, fn: Handler, okStatus?: number): Promise<Response> {
  try {
    const auth = await authenticate();
    if (auth instanceof Response) return auth;
    const result = await fn(serviceFor(auth.db), auth.userId, request);
    return result instanceof Response ? result : toResponse(result, okStatus);
  } catch (err) {
    console.error('room route failed:', err);
    return errorResponse(500, 'INTERNAL');
  }
}

/** Handler for routes without a room code (POST /api/rooms). */
export function roomsRoute(fn: Handler, okStatus?: number) {
  return (request: Request) => handle(request, fn, okStatus);
}

/** Handler for /api/rooms/[code]/...: validates the code (malformed -> 404) before calling `fn`. */
export function roomRoute(
  fn: (svc: RoomService, code: string, userId: string, request: Request) => Promise<ServiceResult<unknown> | Response>,
) {
  return async (request: Request, ctx: RoomRouteContext) => {
    const { code } = await ctx.params;
    return handle(request, async (svc, userId, req) =>
      CODE_RE.test(code) ? fn(svc, code, userId, req) : errorResponse(404, 'ROOM_NOT_FOUND'),
    );
  };
}
