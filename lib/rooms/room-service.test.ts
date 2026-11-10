import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCatalogClient, resolveTarget } from '@/lib/catalog/target';
import {
  COUNTDOWN_MS,
  DEFAULT_TIME_LIMIT_MS,
  MAX_PLAYERS,
  PRESENT_MS,
  REVEAL_MS,
  ROOM_IDLE_CLOSE_MS,
} from './config';
import { mulberry32 } from './round-builder';
import { pointsFor } from './scoring';
import { createRoomRepo } from './room-repo';
import { createRoomService, type RoomService, type ServiceResult } from './room-service';

/**
 * Runs against the LOCAL Supabase (`npx supabase start`). Synthetic users, tracks and rooms are
 * created per run and removed in afterAll. Time comes from a fake clock, so phase deadlines are
 * driven by moving `now` instead of waiting.
 */

const RUN = Math.random().toString(36).slice(2, 8);
const BASE_ITUNES = 9_200_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1000;
const GENRE = `ZZ Room Genre ${RUN}`;
const SMALL_GENRE = `ZZ Room Small ${RUN}`;
const BROKEN_INDEX = 3; // the track whose preview URL fails the HEAD check in the start test

let db: SupabaseClient;
const users: string[] = [];
const roomIds = new Set<string>();
const trackUrls: string[] = [];

let now = 1_900_000_000_000;
let afterNow: (() => void) | null = null;
const clock = {
  now() {
    const t = now;
    if (afterNow) {
      const f = afterNow;
      afterNow = null;
      f();
    }
    return t;
  },
};

let notified: [string, number][] = [];
const notify = async (code: string, version: number) => {
  notified.push([code, version]);
};

let brokenUrls = new Set<string>();
let headCalls: string[] = [];
const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === 'HEAD') headCalls.push(u);
  return new Response(null, { status: brokenUrls.has(u) ? 404 : 200 });
};

function service(seed = 42): RoomService {
  return createRoomService({ db, clock, notify, fetchFn, rng: mulberry32(seed) });
}

function ok<T>(res: ServiceResult<T>): T {
  if (!res.ok) throw new Error(`expected ok, got ${res.status} ${res.error}`);
  return res.data;
}

async function roomRow(code: string) {
  const { data, error } = await db
    .from('rooms')
    .select('id, phase, round_idx, version, phase_ends_at, closed_at, game_no, last_activity_at')
    .eq('code', code)
    .order('closed_at', { ascending: false, nullsFirst: true })
    .limit(1)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function createUser(i: number): Promise<string> {
  const res = await db.auth.admin.createUser({ email: `room-${RUN}-${i}@example.test`, email_confirm: true });
  if (res.error) throw new Error(res.error.message);
  const id = res.data.user.id;
  const p = await db.from('profiles').insert({ id, nickname: `Người ${i}`, avatar_seed: `seed-${i}` });
  if (p.error) throw new Error(p.error.message);
  return id;
}

async function newRoom(svc: RoomService, host = users[0]) {
  const { code } = ok(await svc.createRoom(host));
  roomIds.add((await roomRow(code)).id);
  return code;
}

/** Room with `n` players, playable theme, 5 questions, started and moved into question(0). */
async function roomInQuestion(svc: RoomService, n: number) {
  const code = await newRoom(svc);
  for (let i = 1; i < n; i++) ok(await svc.join(code, users[i]));
  ok(await svc.updateSettings(code, users[0], { questionCount: 5 }));
  ok(await svc.updateTheme(code, users[0], { type: 'genre', key: GENRE }));
  ok(await svc.start(code, users[0]));
  now += COUNTDOWN_MS;
  ok(await svc.tick(code, users[0]));
  now += PRESENT_MS;
  ok(await svc.tick(code, users[0]));
  expect((await roomRow(code)).phase).toBe('question');
  return code;
}

beforeAll(async () => {
  db = createCatalogClient(resolveTarget('local'));
  for (let i = 0; i < MAX_PLAYERS + 2; i++) users.push(await createUser(i));

  const artists = ['Ca Sĩ Một', 'Ca Sĩ Hai', 'Ca Sĩ Ba', 'Ca Sĩ Bốn', 'Ca Sĩ Năm'];
  const rows = Array.from({ length: 16 }, (_, i) => ({
    itunes_track_id: BASE_ITUNES + i,
    preview_url: `https://audio.test/${RUN}/${i}.m4a`,
    title: `Bài Phòng ${i}`,
    title_norm: `bai phong ${i}`,
    artist: artists[i % artists.length],
    artist_norm: `ca si ${i % artists.length}`,
    language: 'vi',
    genre: GENRE,
    cover_url: `https://cover.test/${RUN}/${i}.jpg`,
  }));
  const small = Array.from({ length: 5 }, (_, i) => ({
    itunes_track_id: BASE_ITUNES + 100 + i,
    preview_url: `https://audio.test/${RUN}/s${i}.m4a`,
    title: `Bài Nhỏ ${i}`,
    title_norm: `bai nho ${i}`,
    artist: 'Ca Sĩ Nhỏ',
    artist_norm: 'ca si nho',
    language: 'vi',
    genre: SMALL_GENRE,
  }));
  const ins = await db.from('tracks').insert([...rows, ...small]);
  if (ins.error) throw new Error(ins.error.message);
  trackUrls.push(...rows.map((r) => r.preview_url));
}, 60_000);

afterAll(async () => {
  if (!db) return;
  if (roomIds.size) await db.from('rooms').delete().in('id', [...roomIds]);
  // rooms created through codes we did not record (safety net): any room hosted by a test user
  if (users.length) await db.from('rooms').delete().in('host_id', users);
  await db
    .from('tracks')
    .delete()
    .gte('itunes_track_id', BASE_ITUNES)
    .lt('itunes_track_id', BASE_ITUNES + 1000);
  for (const id of users) await db.auth.admin.deleteUser(id);
}, 60_000);

beforeEach(() => {
  now += 10 * 60 * 1000;
  notified = [];
  brokenUrls = new Set();
  headCalls = [];
  afterNow = null;
});

describe('room service (local Supabase)', () => {
  it('create room generates a 5-digit code unique among open rooms', async () => {
    const first = await newRoom(service());
    expect(first).toMatch(/^[0-9]{5}$/);

    // An rng whose first draw maps to the code that is already open, then something else.
    const firstDraw = (Number(first) - 10000) / 90000 + 1e-9;
    const draws = [firstDraw, firstDraw, 0.123456];
    const rng = () => draws.shift() ?? Math.random();
    const svc = createRoomService({ db, clock, notify, fetchFn, rng });
    const { code: second } = ok(await svc.createRoom(users[1]));
    roomIds.add((await roomRow(second)).id);
    expect(second).toMatch(/^[0-9]{5}$/);
    expect(second).not.toBe(first);

    const snap = ok(await svc.getSnapshot(first, users[0]));
    expect(snap.phase).toBe('lobby');
    expect(snap.hostId).toBe(users[0]);
    expect(snap.players.map((p) => p.id)).toEqual([users[0]]);
    expect(snap.settings).toEqual({
      questionCount: 10,
      timeLimitMs: DEFAULT_TIME_LIMIT_MS,
      showLiveAnswers: true,
      lateJoin: true,
    });
    expect(snap.theme).toBeNull();
  });

  it('11th join returns 409 ROOM_FULL', async () => {
    const svc = service();
    const code = await newRoom(svc);
    for (let i = 1; i < MAX_PLAYERS; i++) ok(await svc.join(code, users[i]));
    const res = await svc.join(code, users[MAX_PLAYERS]);
    expect(res).toEqual({ ok: false, status: 409, error: 'ROOM_FULL' });
    const snap = ok(await svc.getSnapshot(code, users[0]));
    expect(snap.players).toHaveLength(MAX_PLAYERS);
  });

  it('join to a closed room returns 404', async () => {
    const svc = service();
    const code = await newRoom(svc);
    await db.from('rooms').update({ closed_at: new Date(now).toISOString() }).eq('code', code);
    expect(await svc.join(code, users[1])).toEqual({ ok: false, status: 404, error: 'ROOM_NOT_FOUND' });
    expect(await svc.getSnapshot(code, users[0])).toMatchObject({ ok: false, status: 404 });
    expect(await svc.join('00000', users[1])).toMatchObject({ ok: false, status: 404 });
  });

  it('room with no heartbeat for ROOM_IDLE_CLOSE_MS is closed on next access', async () => {
    const svc = service();
    const code = await newRoom(svc);
    now += ROOM_IDLE_CLOSE_MS - 1000;
    ok(await svc.heartbeat(code, users[0])); // activity keeps it open
    now += ROOM_IDLE_CLOSE_MS - 1000;
    ok(await svc.getSnapshot(code, users[0]));
    now += 2000; // > ROOM_IDLE_CLOSE_MS since the last heartbeat
    expect(await svc.getSnapshot(code, users[0])).toEqual({
      ok: false,
      status: 404,
      error: 'ROOM_NOT_FOUND',
    });
    const row = await roomRow(code);
    expect(row.closed_at).not.toBeNull();
    expect(Date.parse(row.closed_at!)).toBe(now);
  });

  it('start replaces a track whose preview URL fails the HEAD check', async () => {
    const svc = createRoomService({ db, clock, notify, fetchFn, rng: mulberry32(7) });
    const code = await newRoom(svc);
    ok(await svc.updateSettings(code, users[0], { questionCount: 15 }));
    ok(await svc.updateTheme(code, users[0], { type: 'genre', key: GENRE }));
    const broken = trackUrls[BROKEN_INDEX];
    brokenUrls = new Set([broken]);
    ok(await svc.start(code, users[0]));

    // with 15 of 16 tracks needed the broken one is drawn and checked...
    expect(headCalls).toContain(broken);
    // ...but the stored rounds do not use it
    const { id } = await roomRow(code);
    const { data } = await db
      .from('room_rounds')
      .select('idx, tracks(preview_url)')
      .eq('room_id', id)
      .eq('game_no', 1);
    const urls = (data ?? []).map((r) => (r.tracks as unknown as { preview_url: string }).preview_url);
    expect(urls).toHaveLength(15);
    expect(new Set(urls).size).toBe(15);
    expect(urls).not.toContain(broken);
    expect((await roomRow(code)).phase).toBe('countdown');
  });

  it('start fails with THEME_NOT_PLAYABLE when too many previews are broken', async () => {
    const svc = service();
    const code = await newRoom(svc);
    ok(await svc.updateSettings(code, users[0], { questionCount: 15 }));
    ok(await svc.updateTheme(code, users[0], { type: 'genre', key: GENRE }));
    brokenUrls = new Set(trackUrls.slice(0, 2));
    expect(await svc.start(code, users[0])).toEqual({ ok: false, status: 409, error: 'THEME_NOT_PLAYABLE' });
    expect((await roomRow(code)).phase).toBe('lobby');
  });

  it('theme with too few tracks is rejected with THEME_NOT_PLAYABLE', async () => {
    const svc = service();
    const code = await newRoom(svc);
    expect(await svc.updateTheme(code, users[0], { type: 'genre', key: SMALL_GENRE })).toEqual({
      ok: false,
      status: 409,
      error: 'THEME_NOT_PLAYABLE',
    });
    expect(await svc.updateTheme(code, users[0], { type: 'genre', key: `nope-${RUN}` })).toMatchObject({
      status: 409,
      error: 'THEME_NOT_PLAYABLE',
    });
    expect(await svc.updateTheme(code, users[1], { type: 'genre', key: GENRE })).toMatchObject({
      status: 403,
      error: 'NOT_IN_ROOM',
    });
  });

  it('every successful command calls notifyRoomChanged with the new version', async () => {
    const svc = service();
    const code = await newRoom(svc);
    let version = (await roomRow(code)).version;

    const expectNotified = async (label: string) => {
      const row = await roomRow(code);
      expect(row.version, label).toBe(version + 1);
      expect(notified, label).toEqual([[code, row.version]]);
      version = row.version;
      notified = [];
    };
    const expectSilent = async (label: string) => {
      expect((await roomRow(code)).version, label).toBe(version);
      expect(notified, label).toEqual([]);
    };

    ok(await svc.join(code, users[1]));
    await expectNotified('join');
    ok(await svc.join(code, users[1]));
    await expectSilent('repeated join is a no-op');
    ok(await svc.updateSettings(code, users[0], { questionCount: 5 }));
    await expectNotified('settings');
    ok(await svc.updateTheme(code, users[0], { type: 'genre', key: GENRE }));
    await expectNotified('theme');
    ok(await svc.tick(code, users[1]));
    await expectSilent('tick in lobby with host online');
    ok(await svc.start(code, users[0]));
    await expectNotified('start');
    ok(await svc.tick(code, users[1]));
    await expectSilent('tick before the deadline');

    now += COUNTDOWN_MS;
    ok(await svc.tick(code, users[1]));
    await expectNotified('tick countdown -> presenting');

    for (let idx = 0; idx < 5; idx++) {
      ok(await svc.heartbeat(code, users[0]));
      ok(await svc.heartbeat(code, users[1]));
      await expectSilent(`routine heartbeat ${idx}`);
      now += PRESENT_MS;
      ok(await svc.tick(code, users[0]));
      await expectNotified(`tick presenting -> question ${idx}`);
      const snap = ok(await svc.getSnapshot(code, users[0]));
      ok(await svc.answer(code, users[0], snap.round!.choices![0].answerId));
      await expectNotified(`answer ${idx}`);
      now += DEFAULT_TIME_LIMIT_MS;
      ok(await svc.tick(code, users[1]));
      await expectNotified(`tick question -> reveal ${idx}`);
      now += REVEAL_MS;
      ok(await svc.tick(code, users[1]));
      await expectNotified(`tick reveal -> next ${idx}`);
    }
    expect((await roomRow(code)).phase).toBe('results');

    ok(await svc.rematch(code, users[0]));
    await expectNotified('rematch');
    expect((await roomRow(code)).game_no).toBe(2);

    // heartbeat after being offline bumps the version (others must refetch)
    now += 60_000;
    ok(await svc.heartbeat(code, users[1]));
    await expectNotified('heartbeat after offline');

    ok(await svc.leave(code, users[1]));
    await expectNotified('leave');
  }, 60_000);

  it('concurrent tick calls produce exactly one phase change in the DB', async () => {
    const svc = service();
    const code = await newRoom(svc);
    ok(await svc.updateTheme(code, users[0], { type: 'genre', key: GENRE }));
    ok(await svc.start(code, users[0]));
    const before = await roomRow(code);
    expect(before.phase).toBe('countdown');
    notified = [];

    now += COUNTDOWN_MS + 50;
    const results = await Promise.all(Array.from({ length: 5 }, () => service().tick(code, users[0])));
    for (const r of results) expect(r.ok).toBe(true);

    const after = await roomRow(code);
    expect(after.phase).toBe('presenting');
    expect(after.round_idx).toBe(0);
    expect(after.version).toBe(before.version + 1);
    expect(notified).toEqual([[code, before.version + 1]]);

    // repeated ticks before the new deadline change nothing
    await Promise.all(Array.from({ length: 3 }, () => service().tick(code, users[0])));
    expect((await roomRow(code)).version).toBe(before.version + 1);
  });

  it('answer timing uses server clock: remaining time comes from deadline_at minus server receive time', async () => {
    const svc = service();
    const code = await roomInQuestion(svc, 2);
    const room = await roomRow(code);
    const { data: rnd } = await db
      .from('room_rounds')
      .select('correct_answer_id, choices, started_at, deadline_at')
      .eq('room_id', room.id)
      .eq('game_no', 1)
      .eq('idx', 0)
      .single();
    const deadline = Date.parse(rnd!.deadline_at!);
    expect(deadline).toBe(Date.parse(room.phase_ends_at!));
    expect(deadline - Date.parse(rnd!.started_at!)).toBe(DEFAULT_TIME_LIMIT_MS);

    // received 4s into the question; the clock then jumps (slow processing) — must not matter
    const receivedAt = deadline - DEFAULT_TIME_LIMIT_MS + 4000;
    now = receivedAt;
    afterNow = () => {
      now = deadline - 1000;
    };
    ok(await svc.answer(code, users[0], rnd!.correct_answer_id));
    const wrong = (rnd!.choices as { answerId: string }[]).find((c) => c.answerId !== rnd!.correct_answer_id)!;
    ok(await svc.answer(code, users[1], wrong.answerId));

    const { data: answers } = await db
      .from('room_answers')
      .select('player_id, answered_at, points')
      .eq('room_id', room.id)
      .eq('game_no', 1)
      .eq('idx', 0);
    const mine = answers!.find((a) => a.player_id === users[0])!;
    expect(Date.parse(mine.answered_at)).toBe(receivedAt);
    expect(mine.points).toBe(pointsFor(1, true, deadline - receivedAt, DEFAULT_TIME_LIMIT_MS));
    expect(answers!.find((a) => a.player_id === users[1])!.points).toBe(0);

    // answering twice / after the deadline / with a bad id
    expect(await svc.answer(code, users[0], wrong.answerId)).toMatchObject({ status: 409, error: 'ALREADY_ANSWERED' });
    expect(await svc.answer(code, users[2], wrong.answerId)).toMatchObject({ status: 403, error: 'NOT_IN_ROOM' });
    now = deadline + 1;
    ok(await svc.join(code, users[2])); // late joiner (after the deadline but before tick)
    expect(await svc.answer(code, users[2], 'not-a-choice')).toMatchObject({ status: 400, error: 'INVALID_ANSWER' });
    expect(await svc.answer(code, users[2], wrong.answerId)).toMatchObject({ status: 409, error: 'TOO_LATE' });
  });

  it('concurrent answers from different players (all 10 at once) are all recorded', async () => {
    const svc = service();
    const code = await roomInQuestion(svc, MAX_PLAYERS);
    const before = await roomRow(code);
    const snap = ok(await svc.getSnapshot(code, users[0]));
    const choice = snap.round!.choices![1].answerId;
    now += 2000;
    const results = await Promise.all(
      users.slice(0, MAX_PLAYERS).map((u, i) => service(100 + i).answer(code, u, choice)),
    );
    expect(results).toEqual(results.map(() => ({ ok: true, data: expect.anything() })));

    const { data: answers } = await db
      .from('room_answers')
      .select('player_id')
      .eq('room_id', before.id)
      .eq('game_no', 1)
      .eq('idx', 0);
    expect(answers).toHaveLength(MAX_PLAYERS);
    expect((await roomRow(code)).version).toBe(before.version + MAX_PLAYERS);
    const live = ok(await svc.getSnapshot(code, users[0]));
    expect(live.round!.answeredCount).toBe(MAX_PLAYERS);
    expect(live.round!.livePercentages![choice]).toBe(100);
  }, 30_000);

  it('snapshot from the service in question phase has no correct answer; reveal has it', async () => {
    const svc = service();
    const code = await roomInQuestion(svc, 2);
    const q = ok(await svc.getSnapshot(code, users[1]));
    expect(q.round!.choices).toHaveLength(4);
    expect(q.round!.reveal).toBeNull();
    expect(JSON.stringify(q)).not.toContain('correctAnswerId');
    expect(JSON.stringify(q)).not.toContain('cover.test');
    expect(q.round!.audioUrl).toMatch(/^https:\/\/audio\.test\//);
    expect(q.round!.nextAudioUrl).toMatch(/^https:\/\/audio\.test\//);

    now += DEFAULT_TIME_LIMIT_MS;
    ok(await svc.tick(code, users[1]));
    const r = ok(await svc.getSnapshot(code, users[1]));
    expect(r.phase).toBe('reveal');
    expect(q.round!.choices!.map((c) => c.answerId)).toContain(r.round!.reveal!.correctAnswerId);
    expect(r.round!.reveal!.track.coverUrl).toMatch(/^https:\/\/cover\.test\//);
  });

  it('commands from a non-member are rejected with 403 NOT_IN_ROOM; GET works for anyone', async () => {
    const svc = service();
    const code = await newRoom(svc);
    for (const res of [
      await svc.tick(code, users[5]),
      await svc.heartbeat(code, users[5]),
      await svc.leave(code, users[5]),
      await svc.start(code, users[5]),
      await svc.rematch(code, users[5]),
      await svc.updateSettings(code, users[5], { lateJoin: false }),
    ]) {
      expect(res).toEqual({ ok: false, status: 403, error: 'NOT_IN_ROOM' });
    }
    const snap = ok(await svc.getSnapshot(code, users[5]));
    expect(snap.isMember).toBe(false);
    ok(await svc.join(code, users[1]));
    expect(await svc.start(code, users[1])).toEqual({ ok: false, status: 409, error: 'NOT_HOST' });
    expect(await svc.start(code, users[0])).toEqual({ ok: false, status: 409, error: 'THEME_REQUIRED' });
    expect(await svc.updateSettings(code, users[0], { questionCount: 7 })).toEqual({
      ok: false,
      status: 409,
      error: 'INVALID_SETTINGS',
    });
  });

  it('a stale save does not overwrite a newer last_seen_at', async () => {
    const svc = service();
    const code = await newRoom(svc);
    ok(await svc.join(code, users[1]));
    const repo = createRoomRepo(db);
    const loaded = (await repo.load(code))!;
    const t0 = loaded.state.players.find((p) => p.id === users[1])!.lastSeenAt;

    // a heartbeat lands after `loaded` was read
    now += 5000;
    ok(await svc.heartbeat(code, users[1]));

    // a save built from the older state (changes the player's score, carries the old lastSeenAt)
    const next = {
      ...loaded.state,
      version: loaded.state.version + 1,
      players: loaded.state.players.map((p) => (p.id === users[1] ? { ...p, score: 42, lastSeenAt: t0 } : p)),
    };
    expect(await repo.save(loaded.roomId, loaded.state, next, [], { nowMs: now })).toBe('ok');
    const { data } = await db
      .from('room_players')
      .select('score, last_seen_at')
      .eq('room_id', loaded.roomId)
      .eq('player_id', users[1])
      .single();
    expect(data!.score).toBe(42);
    expect(Date.parse(data!.last_seen_at)).toBe(now);

    // and a save with a stale expected version is a conflict that writes nothing
    expect(
      await repo.save(loaded.roomId, loaded.state, { ...next, players: [] }, [], { nowMs: now }),
    ).toBe('conflict');
  });

  it('a returning player is restored and late joiners start from the next round', async () => {
    const svc = service();
    const code = await roomInQuestion(svc, 2);
    ok(await svc.join(code, users[3]));
    const snap = ok(await svc.getSnapshot(code, users[3]));
    expect(snap.players.find((p) => p.id === users[3])!.joinedRound).toBe(1);
    expect(snap.round!.canAnswer).toBe(false);

    ok(await svc.leave(code, users[1]));
    expect(ok(await svc.getSnapshot(code, users[0])).players.map((p) => p.id)).not.toContain(users[1]);
    ok(await svc.join(code, users[1]));
    const back = ok(await svc.getSnapshot(code, users[1]));
    expect(back.players.find((p) => p.id === users[1])).toMatchObject({ joinedRound: 0, online: true });
  });

  it('unknown room id for every command is 404 (no exceptions)', async () => {
    const svc = service();
    const code = '0' + randomUUID().replace(/\D/g, '').slice(0, 4);
    expect(await svc.tick(code, users[0])).toMatchObject({ status: 404 });
    expect(await svc.answer(code, users[0], 'x')).toMatchObject({ status: 404 });
    expect(await svc.updateTheme(code, users[0], { type: 'genre', key: GENRE })).toMatchObject({ status: 404 });
  });
});
