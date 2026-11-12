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
import { systemClock, type Clock } from './clock';
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
  // Verifies the session JWT on the server (signature + expiry, keys cached) instead of a round trip
  // to the Auth server on every command; falls back to that round trip for symmetric keys.
  const { data, error } = await session.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return errorResponse(401, 'UNAUTHENTICATED');
  const db = createAdminClient();
  const profile = await db.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (profile.error) throw new Error(`profile lookup: ${profile.error.message}`);
  if (!profile.data) return errorResponse(403, 'PROFILE_REQUIRED');
  return { userId, db };
}

function serviceFor(db: SupabaseClient, clock: Clock): RoomService {
  return createRoomService({
    db,
    clock,
    notify: createRoomNotifier(db),
    fetchFn: (url, init) => fetch(url, init),
    rng: Math.random,
  });
}

type Handler = (
  svc: RoomService,
  userId: string,
  request: Request,
  /** Same service on the real clock (differs from `svc` only with atReceiveTime). */
  live: RoomService,
) => Promise<ServiceResult<unknown> | Response>;

interface RouteOptions {
  okStatus?: number;
  /**
   * Freeze the service clock at request arrival, so the auth + profile round trips do not count
   * against the player (answers are scored from deadline minus receive time).
   */
  atReceiveTime?: boolean;
}

async function handle(request: Request, fn: Handler, opts: RouteOptions = {}): Promise<Response> {
  const receivedAtMs = systemClock.now();
  try {
    const auth = await authenticate();
    if (auth instanceof Response) return auth;
    const svc = serviceFor(auth.db, opts.atReceiveTime ? { now: () => receivedAtMs } : systemClock);
    const live = opts.atReceiveTime ? serviceFor(auth.db, systemClock) : svc;
    const result = await fn(svc, auth.userId, request, live);
    return result instanceof Response ? result : toResponse(result, opts.okStatus);
  } catch (err) {
    console.error('room route failed:', err);
    return errorResponse(500, 'INTERNAL');
  }
}

/** Handler for routes without a room code (POST /api/rooms). */
export function roomsRoute(fn: Handler, okStatus?: number) {
  return (request: Request) => handle(request, fn, { okStatus });
}

/** Adds the caller's fresh snapshot to a successful command result; leaves it out if that fails. */
async function withSnapshot(
  result: ServiceResult<unknown> | Response,
  live: RoomService,
  code: string,
  userId: string,
): Promise<ServiceResult<unknown> | Response> {
  if (result instanceof Response || !result.ok) return result;
  try {
    const snap = await live.getSnapshot(code, userId);
    if (snap.ok) return { ok: true, data: { ...(result.data as object), snapshot: snap.data } };
  } catch (err) {
    console.error('snapshot after command failed:', err);
  }
  return result; // the client falls back to refetching on the returned version
}

/**
 * Handler for /api/rooms/[code]/...: validates the code (malformed -> 404) before calling `fn`.
 * `withSnapshot`: a command's response also carries the caller's new snapshot, so the client
 * shows the result after one round trip instead of two (command, then GET).
 */
export function roomRoute(
  fn: (svc: RoomService, code: string, userId: string, request: Request) => Promise<ServiceResult<unknown> | Response>,
  opts: Pick<RouteOptions, 'atReceiveTime'> & { withSnapshot?: boolean } = {},
) {
  return async (request: Request, ctx: RoomRouteContext) => {
    const { code } = await ctx.params;
    return handle(
      request,
      async (svc, userId, req, live) => {
        if (!CODE_RE.test(code)) return errorResponse(404, 'ROOM_NOT_FOUND');
        const result = await fn(svc, code, userId, req);
        return opts.withSnapshot ? withSnapshot(result, live, code, userId) : result;
      },
      opts,
    );
  };
}
