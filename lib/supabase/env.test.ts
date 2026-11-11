import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicSupabaseEnv } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publicSupabaseEnv', () => {
  it('returns the public URL and anon key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    expect(publicSupabaseEnv()).toEqual({ url: 'http://127.0.0.1:54321', anonKey: 'anon' });
  });

  it('names the missing variable instead of failing later with an opaque error', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    expect(() => publicSupabaseEnv()).toThrow('NEXT_PUBLIC_SUPABASE_URL');
  });
});
