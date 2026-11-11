import { execSync } from 'node:child_process';

export interface LocalSupabase {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

/** Reads URL and keys of the LOCAL Supabase stack (`supabase start`). Refuses non-local URLs. */
export function localSupabase(): LocalSupabase {
  const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const vars: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) vars[m[1]] = m[2];
  }
  const url = vars.API_URL;
  const host = url ? new URL(url).hostname : '';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`e2e needs the local Supabase stack (got API_URL=${url ?? 'none'}); run \`npx supabase start\``);
  }
  return { url, anonKey: vars.ANON_KEY, serviceRoleKey: vars.SERVICE_ROLE_KEY };
}
