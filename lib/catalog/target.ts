import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Where the catalog importer writes. Deliberately does NOT import lib/supabase/admin.ts
 * (that module is `server-only` and would break in a tsx/Vitest node context).
 *
 * Env vars (never printed):
 *   staging: CATALOG_STAGING_SUPABASE_URL, CATALOG_STAGING_SERVICE_ROLE_KEY
 *   prod:    CATALOG_PROD_SUPABASE_URL,    CATALOG_PROD_SERVICE_ROLE_KEY
 *   local:   `npx supabase status -o env`, or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *            when that URL is localhost / 127.0.0.1 (a remote URL there is ignored).
 */
export type Target = 'local' | 'staging' | 'prod';
export interface TargetConfig {
  target: Target;
  url: string;
  serviceKey: string;
}

export function parseTarget(value: string | undefined): Target {
  if (value === 'local' || value === 'staging' || value === 'prod') return value;
  throw new Error(`--target must be one of local|staging|prod (got ${value ? `"${value}"` : 'nothing'})`);
}

function defaultStatus(): string {
  return execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function parseStatusEnv(out: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export function resolveTarget(
  target: Target,
  env: Record<string, string | undefined> = process.env,
  runStatus: () => string = defaultStatus,
): TargetConfig {
  if (target === 'local') {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key && isLocalUrl(url)) return { target, url, serviceKey: key };
    const vars = parseStatusEnv(runStatus());
    if (!vars.API_URL || !vars.SERVICE_ROLE_KEY) {
      throw new Error('Cannot determine the local Supabase URL/key; is `npx supabase start` running?');
    }
    return { target, url: vars.API_URL, serviceKey: vars.SERVICE_ROLE_KEY };
  }

  const prefix = target === 'prod' ? 'CATALOG_PROD' : 'CATALOG_STAGING';
  const urlName = `${prefix}_SUPABASE_URL`;
  const keyName = `${prefix}_SERVICE_ROLE_KEY`;
  const url = env[urlName];
  const serviceKey = env[keyName];
  if (!url || !serviceKey) {
    const missing = [!url && urlName, !serviceKey && keyName].filter(Boolean);
    throw new Error(`Missing environment variable(s) for target "${target}": ${missing.join(', ')}`);
  }
  return { target, url, serviceKey };
}

export function createCatalogClient(cfg: TargetConfig): SupabaseClient {
  return createClient(cfg.url, cfg.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
