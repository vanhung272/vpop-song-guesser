import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * RLS / privilege tests against a LOCAL Supabase (`npx supabase start`).
 * Keys come from env (SUPABASE_URL | NEXT_PUBLIC_SUPABASE_URL, SUPABASE_ANON_KEY |
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) or `npx supabase status -o env`.
 */
function loadEnv() {
  let url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  let anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    const out = execSync('npx supabase status -o env', { encoding: 'utf8' });
    const vars: Record<string, string> = {};
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
      if (m) vars[m[1]] = m[2];
    }
    url ??= vars.API_URL;
    anonKey ??= vars.ANON_KEY;
    serviceKey ??= vars.SERVICE_ROLE_KEY;
  }
  if (!url || !anonKey || !serviceKey) throw new Error('Cannot determine local Supabase URL/keys');
  return { url, anonKey, serviceKey };
}

const env = loadEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.url, env.serviceKey, opts);
const anon = createClient(env.url, env.anonKey, opts);

const roomId = randomUUID();
const trackId = randomUUID();
const itunesId = Math.floor(Math.random() * 1_000_000_000) + 1_000_000_000;
let userId: string;
let authed: SupabaseClient;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`fixture ${what} failed: ${res.error.message}`);
  return res.data;
}

beforeAll(async () => {
  const created = await admin.auth.admin.createUser({
    email: `rls-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);
  userId = created.data.user.id;

  must(await admin.from('profiles').insert({ id: userId, nickname: 'Fixture', avatar_seed: 'seed' }), 'profile');
  must(
    await admin.from('tracks').insert({
      id: trackId,
      itunes_track_id: itunesId,
      preview_url: 'https://example.test/preview.m4a',
      title: 'Bài Test',
      title_norm: 'bai test',
      artist: 'Ca Sĩ Test',
      artist_norm: 'ca si test',
      language: 'vi',
    }),
    'track',
  );
  must(await admin.from('rooms').insert({ id: roomId, code: '90909', host_id: userId }), 'room');
  must(await admin.from('room_players').insert({ room_id: roomId, player_id: userId }), 'room_player');
  must(
    await admin.from('room_rounds').insert({
      room_id: roomId,
      game_no: 1,
      idx: 0,
      track_id: trackId,
      question_type: 'title',
      choices: [{ answerId: 'a', label: 'Bài Test' }],
      correct_answer_id: 'a',
    }),
    'room_round',
  );
  must(
    await admin.from('room_answers').insert({
      room_id: roomId,
      game_no: 1,
      idx: 0,
      player_id: userId,
      answer_id: 'a',
      points: 800,
    }),
    'room_answer',
  );

  // A signed-in (anonymous auth) user has the `authenticated` role, like real players.
  authed = createClient(env.url, env.anonKey, opts);
  const signIn = await authed.auth.signInAnonymously();
  if (signIn.error) throw new Error(`signInAnonymously: ${signIn.error.message}`);
});

afterAll(async () => {
  await admin.from('rooms').delete().eq('id', roomId);
  await admin.from('tracks').delete().eq('id', trackId);
  if (userId) await admin.auth.admin.deleteUser(userId); // cascades to profiles
  if (authed) await authed.auth.signOut();
});

describe('RLS: public catalog', () => {
  it('anon can select tracks', async () => {
    const { data, error } = await anon.from('tracks').select('id, title, artist').eq('id', trackId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe('Bài Test');
  });

  it('anon can select profiles(id, nickname, avatar_seed) but not other columns', async () => {
    const ok = await anon.from('profiles').select('id, nickname, avatar_seed').eq('id', userId);
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);

    const denied = await anon.from('profiles').select('created_at').eq('id', userId);
    expect(denied.error?.code).toBe('42501');
  });

  it('anon cannot write tracks or profiles', async () => {
    const t = await anon.from('tracks').update({ title: 'hacked' }).eq('id', trackId);
    expect(t.error?.code).toBe('42501');
    const p = await anon.from('profiles').update({ nickname: 'hacked' }).eq('id', userId);
    expect(p.error?.code).toBe('42501');
  });
});

describe('RLS: room tables are service-role only', () => {
  it('service role sees the fixture rows (guards against vacuous passes)', async () => {
    const rooms = await admin.from('rooms').select('id').eq('id', roomId);
    expect(rooms.data).toHaveLength(1);
    for (const table of ['room_players', 'room_rounds', 'room_answers'] as const) {
      const { data, error } = await admin.from(table).select('*').eq('room_id', roomId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
  });

  it('anon select on room_rounds returns no rows even when rows exist', async () => {
    const { data, error } = await anon.from('room_rounds').select('correct_answer_id').eq('room_id', roomId);
    expect(data ?? []).toEqual([]);
    expect(error?.code).toBe('42501');
  });

  it('anon select on room_answers returns no rows', async () => {
    const { data, error } = await anon.from('room_answers').select('*').eq('room_id', roomId);
    expect(data ?? []).toEqual([]);
    expect(error?.code).toBe('42501');
  });

  it('anon cannot insert into rooms', async () => {
    const { error } = await anon.from('rooms').insert({ code: '12345', host_id: userId });
    expect(error?.code).toBe('42501');
    const check = await admin.from('rooms').select('id').eq('code', '12345');
    expect(check.data).toEqual([]);
  });

  it('anon cannot read rooms or room_players', async () => {
    for (const table of ['rooms', 'room_players'] as const) {
      const { data, error } = await anon.from(table).select('*');
      expect(data ?? []).toEqual([]);
      expect(error?.code).toBe('42501');
    }
  });

  it('authenticated (anonymous sign-in) is locked out of all four room tables too', async () => {
    for (const table of ['rooms', 'room_players', 'room_rounds', 'room_answers'] as const) {
      const { data, error } = await authed.from(table).select('*');
      expect(data ?? []).toEqual([]);
      expect(error?.code).toBe('42501');
    }
    const ins = await authed.from('rooms').insert({ code: '54321', host_id: userId });
    expect(ins.error?.code).toBe('42501');
    const upd = await authed.from('room_answers').update({ points: 9999 }).eq('room_id', roomId);
    expect(upd.error?.code).toBe('42501');
  });
});
