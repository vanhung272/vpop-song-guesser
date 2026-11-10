import { execSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { createRoomNotifier, ROOM_CHANGED_EVENT, roomChannel } from './notify';

/** Integration test against the LOCAL Supabase Realtime: a subscriber receives `{ version }` only. */
function localEnv() {
  const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const vars: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) vars[m[1]] = m[2];
  }
  return { url: vars.API_URL, anonKey: vars.ANON_KEY, serviceKey: vars.SERVICE_ROLE_KEY };
}

const env = localEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.url, env.serviceKey, opts);
const listener = createClient(env.url, env.anonKey, opts);
let channel: RealtimeChannel | undefined;

afterAll(async () => {
  if (channel) await listener.removeChannel(channel);
});

describe('notifyRoomChanged', () => {
  it('broadcasts { version } on room:<code>, event "changed"', async () => {
    const code = String(10000 + Math.floor(Math.random() * 90000));
    expect(roomChannel(code)).toBe(`room:${code}`);
    const received: unknown[] = [];

    channel = listener.channel(roomChannel(code));
    await new Promise<void>((resolve, reject) => {
      channel!
        .on('broadcast', { event: ROOM_CHANGED_EVENT }, (msg) => received.push(msg.payload))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status));
        });
    });

    await createRoomNotifier(admin)(code, 17);

    for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([{ version: 17 }]);
  }, 20_000);
});
