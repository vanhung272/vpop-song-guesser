/**
 * Load check: R rooms x C simulated players each play one full game through the real API.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *     npx tsx scripts/load/room-10.ts --base https://<staging-app> [--rooms 3] [--clients 10] [--questions 5]
 *
 * Each player signs in anonymously (needs that many sign-ins in the project's rate limit), creates a
 * profile, subscribes to the room's Realtime channel like the web client, answers at a random time,
 * and ticks when a phase ends. Reports API latency per endpoint, Realtime subscriptions/messages,
 * and whether any phase changed more often than one game needs (a duplicated tick).
 */
import { createServerClient } from '@supabase/ssr';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { expectedTransitions, failedCalls, summarize, type Sample } from './stats';

/** Same retry pace as the web client's useAutoTick. */
const TICK_RETRY_MS = 2000;

interface Args {
  base: string;
  rooms: number;
  clients: number;
  questions: number;
  timeLimitMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const base = get('base');
  if (!base) throw new Error('missing --base <app url>');
  return {
    base: base.replace(/\/$/, ''),
    rooms: Number(get('rooms', '3')),
    clients: Number(get('clients', '10')),
    questions: Number(get('questions', '5')),
    timeLimitMs: Number(get('time-limit-ms', '10000')),
  };
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const samples: Sample[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

interface Snapshot {
  version: number;
  phase: string;
  phaseEndsAt: number | null;
  serverNowMs: number;
  roundIdx: number;
  isMember: boolean;
  players: { id: string }[];
  round: { idx: number; canAnswer: boolean; myAnswer: unknown; choices: { answerId: string }[] | null } | null;
}

class SimPlayer {
  private jar = new Map<string, string>();
  private auth: SupabaseClient;
  private realtime: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private latestBroadcast = 0;
  private wake: (() => void) | null = null;
  subscribed = false;
  broadcasts = 0;
  changedTicks: number[] = [];
  phasesSeen: string[] = [];

  constructor(
    private readonly base: string,
    readonly name: string,
  ) {
    this.auth = createServerClient(SUPABASE_URL!, ANON_KEY!, {
      cookies: {
        getAll: () => [...this.jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const c of list) {
            if (c.value) this.jar.set(c.name, c.value);
            else this.jar.delete(c.name);
          }
        },
      },
    });
    this.realtime = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false } });
  }

  private cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async api<T>(endpoint: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const t0 = performance.now();
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { cookie: this.cookieHeader(), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as T;
    const error = res.ok ? undefined : ((data as { error?: string } | null)?.error ?? `HTTP_${res.status}`);
    samples.push({ endpoint, ms: Math.round(performance.now() - t0), status: res.status, error });
    return { status: res.status, data };
  }

  async signUp() {
    const { error } = await this.auth.auth.signInAnonymously();
    if (error) throw new Error(`${this.name}: anonymous sign-in failed: ${error.message}`);
    const res = await this.api('POST profile', 'POST', '/api/profile', { nickname: this.name, avatarSeed: `load-${Math.random().toString(36).slice(2, 12)}` });
    if (res.status !== 200) throw new Error(`${this.name}: profile failed (${res.status})`);
  }

  subscribe(code: string) {
    return new Promise<void>((resolve) => {
      this.channel = this.realtime
        .channel(`room:${code}`)
        .on('broadcast', { event: 'changed' }, ({ payload }) => {
          this.broadcasts++;
          const v = (payload as { version?: number })?.version;
          if (typeof v === 'number' && v > this.latestBroadcast) {
            this.latestBroadcast = v;
            this.wake?.();
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.subscribed = true;
            resolve();
          }
        });
      setTimeout(resolve, 10_000); // report, don't hang, if Realtime never confirms
    });
  }

  /** Waits until `ms` passes or a newer version is broadcast. */
  private waitFor(ms: number, version: number) {
    if (this.latestBroadcast > version) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  /** Plays until results: answers once per round at a random moment, ticks when a phase ends. */
  async play(code: string) {
    let answeredRound = -1;
    for (;;) {
      const { status, data: snap } = await this.api<Snapshot>('GET snapshot', 'GET', `/api/rooms/${code}`);
      if (status !== 200) throw new Error(`${this.name}: snapshot ${status}`);
      const key = `${snap.roundIdx}:${snap.phase}`;
      if (this.phasesSeen.at(-1) !== key) this.phasesSeen.push(key);
      if (snap.phase === 'results') return;

      const offset = snap.serverNowMs - Date.now();
      const now = () => Date.now() + offset;
      if (snap.phase === 'question' && snap.round?.canAnswer && !snap.round.myAnswer && answeredRound !== snap.round.idx) {
        answeredRound = snap.round.idx;
        const choices = snap.round.choices ?? [];
        const answerIn = Math.random() * Math.max(0, (snap.phaseEndsAt ?? now()) - now() - 500);
        void sleep(answerIn).then(() =>
          this.api('POST answer', 'POST', `/api/rooms/${code}/answer`, {
            answerId: choices[Math.floor(Math.random() * choices.length)]?.answerId,
          }),
        );
      }
      if (snap.phaseEndsAt == null) {
        await this.waitFor(1000, snap.version);
        continue;
      }
      await this.waitFor(snap.phaseEndsAt - now() + Math.random() * 300, snap.version);
      if (now() >= snap.phaseEndsAt) {
        const tick = await this.api<{ version: number; changed: boolean }>('POST tick', 'POST', `/api/rooms/${code}/tick`);
        if (tick.data?.changed) this.changedTicks.push(tick.data.version);
        // Like the web client: if this tick did not advance the room, back off instead of spinning.
        else await this.waitFor(TICK_RETRY_MS, snap.version);
      }
    }
  }

  async close() {
    if (this.channel) await this.realtime.removeChannel(this.channel);
  }
}

async function runRoom(args: Args, roomNo: number) {
  const players = Array.from({ length: args.clients }, (_, i) => new SimPlayer(args.base, `Tải ${roomNo}-${i + 1}`));
  for (const p of players) await p.signUp(); // sequential: friendlier to the sign-in rate limit
  const host = players[0];

  const created = await host.api<{ code: string }>('POST rooms', 'POST', '/api/rooms');
  if (created.status !== 201) throw new Error(`room ${roomNo}: create failed (${created.status})`);
  const code = created.data.code;
  await Promise.all(players.map((p) => p.subscribe(code)));
  await Promise.all(players.slice(1).map((p) => p.api('POST join', 'POST', `/api/rooms/${code}/join`)));

  const themes = await host.api<{ type: string; key: string; playable: boolean }[]>('GET themes', 'GET', '/api/themes?type=artist');
  const theme = themes.data.find((t) => t.playable);
  if (!theme) throw new Error('no playable artist theme in this catalog');
  await host.api('PATCH settings', 'PATCH', `/api/rooms/${code}/settings`, {
    questionCount: args.questions,
    timeLimitMs: args.timeLimitMs,
  });
  await host.api('PATCH theme', 'PATCH', `/api/rooms/${code}/theme`, { type: theme.type, key: theme.key });
  const start = await host.api('POST start', 'POST', `/api/rooms/${code}/start`);
  if (start.status !== 200) throw new Error(`room ${roomNo}: start failed (${start.status} ${JSON.stringify(start.data)})`);

  await Promise.all(players.map((p) => p.play(code)));
  await Promise.all(players.map((p) => p.close()));

  const changedVersions = new Set(players.flatMap((p) => p.changedTicks));
  const roundsSeen = new Set(host.phasesSeen.map((k) => k.split(':')[0]));
  return {
    roomNo,
    code,
    subscribed: players.filter((p) => p.subscribed).length,
    broadcasts: players.reduce((a, p) => a + p.broadcasts, 0),
    transitions: changedVersions.size,
    duplicateTickVersions: players.flatMap((p) => p.changedTicks).length - changedVersions.size,
    roundsSeen: roundsSeen.size,
  };
}

async function main() {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const args = parseArgs(process.argv.slice(2));
  console.log(`Load check: ${args.rooms} room(s) x ${args.clients} players, ${args.questions} questions, ${args.base}`);
  const t0 = Date.now();
  const rooms = await Promise.all(Array.from({ length: args.rooms }, (_, i) => runRoom(args, i + 1)));

  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s\n`);
  console.log('| Room | Realtime subscribed | Broadcasts received | Phase changes (expected) | Duplicate changes |');
  console.log('|---|---|---|---|---|');
  for (const r of rooms) {
    console.log(
      `| ${r.roomNo} (${r.code}) | ${r.subscribed}/${args.clients} | ${r.broadcasts} | ${r.transitions} (${expectedTransitions(args.questions)}) | ${r.duplicateTickVersions} |`,
    );
  }
  console.log('\n| Endpoint | Calls | p50 ms | p95 ms | max ms | Errors |');
  console.log('|---|---|---|---|---|---|');
  for (const s of summarize(samples)) {
    const errors = Object.entries(s.errors).map(([k, v]) => `${k}×${v}`).join(', ') || '—';
    console.log(`| ${s.endpoint} | ${s.count} | ${s.p50} | ${s.p95} | ${s.max} | ${errors} |`);
  }
  const failures = failedCalls(samples);
  if (failures > 0) console.log(`${failures} call(s) failed (5xx, no response, or CONFLICT): see the Errors column.`);
  const bad =
    failures > 0 ||
    rooms.some((r) => r.duplicateTickVersions > 0 || r.transitions !== expectedTransitions(args.questions));
  process.exitCode = bad ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
