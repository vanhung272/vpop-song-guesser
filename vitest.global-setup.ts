import { execSync } from 'node:child_process';

/**
 * Resolve the LOCAL Supabase URL/keys once per test run and export them, so DB-backed test files
 * don't each shell out to `npx supabase status` (~5 s each, much slower when run in parallel,
 * which made beforeAll hooks time out). Workers are spawned after this runs and inherit the env.
 *
 * Only fills variables that are not already set, and only with a localhost URL. If the local stack
 * is not running, it does nothing: pure tests still run and DB tests fail with their own message.
 */
export default function setup() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  let out: string;
  try {
    out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return;
  }
  const vars: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) vars[m[1]] = m[2];
  }
  let host = '';
  try {
    host = new URL(vars.API_URL ?? '').hostname;
  } catch {
    return;
  }
  if (host !== '127.0.0.1' && host !== 'localhost') return;
  process.env.SUPABASE_URL ??= vars.API_URL;
  if (vars.ANON_KEY) process.env.SUPABASE_ANON_KEY ??= vars.ANON_KEY;
  if (vars.SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY ??= vars.SERVICE_ROLE_KEY;
}
