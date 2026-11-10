import { describe, expect, it } from 'vitest';
import { parseTarget, resolveTarget } from './target';

const statusOut = [
  'API_URL="http://127.0.0.1:54321"',
  'ANON_KEY="anon-secret"',
  'SERVICE_ROLE_KEY="local-service-key"',
].join('\n');

describe('resolveTarget', () => {
  it('reads staging url and service key from CATALOG_STAGING_* env vars', () => {
    const cfg = resolveTarget('staging', {
      CATALOG_STAGING_SUPABASE_URL: 'https://stg.supabase.co',
      CATALOG_STAGING_SERVICE_ROLE_KEY: 'stg-key',
    });
    expect(cfg).toEqual({ target: 'staging', url: 'https://stg.supabase.co', serviceKey: 'stg-key' });
  });

  it('reads prod from CATALOG_PROD_* and never falls back to the staging vars', () => {
    const env = {
      CATALOG_STAGING_SUPABASE_URL: 'https://stg.supabase.co',
      CATALOG_STAGING_SERVICE_ROLE_KEY: 'stg-key',
    };
    expect(() => resolveTarget('prod', env)).toThrow(/CATALOG_PROD_SUPABASE_URL/);
    expect(
      resolveTarget('prod', {
        CATALOG_PROD_SUPABASE_URL: 'https://prod.supabase.co',
        CATALOG_PROD_SERVICE_ROLE_KEY: 'prod-key',
      }).url,
    ).toBe('https://prod.supabase.co');
  });

  it('names the missing variables but never prints a key', () => {
    let message = '';
    try {
      resolveTarget('staging', { CATALOG_STAGING_SERVICE_ROLE_KEY: 'super-secret-value' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('CATALOG_STAGING_SUPABASE_URL');
    expect(message).not.toContain('super-secret-value');
  });

  it('reads local from `supabase status -o env` output', () => {
    const cfg = resolveTarget('local', {}, () => statusOut);
    expect(cfg).toEqual({ target: 'local', url: 'http://127.0.0.1:54321', serviceKey: 'local-service-key' });
  });

  it('local accepts SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY only when the URL is localhost', () => {
    const ok = resolveTarget(
      'local',
      { SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      () => {
        throw new Error('should not shell out');
      },
    );
    expect(ok.serviceKey).toBe('k');
    // a remote URL in the generic env vars must never be used for "local"
    const cfg = resolveTarget(
      'local',
      { SUPABASE_URL: 'https://prod.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'prod-key' },
      () => statusOut,
    );
    expect(cfg.url).toBe('http://127.0.0.1:54321');
    expect(cfg.serviceKey).toBe('local-service-key');
  });
});

describe('parseTarget', () => {
  it('accepts local|staging|prod and rejects anything else', () => {
    expect(parseTarget('local')).toBe('local');
    expect(parseTarget('prod')).toBe('prod');
    expect(() => parseTarget('production')).toThrow(/local\|staging\|prod/);
    expect(() => parseTarget(undefined)).toThrow(/--target/);
  });
});
