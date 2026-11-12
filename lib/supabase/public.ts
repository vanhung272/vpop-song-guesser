import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { publicSupabaseEnv } from './env';

/**
 * Anonymous Supabase client with no cookies or session: for public reads whose result is the same
 * for every visitor (e.g. the theme list), so the response can be cached by the CDN.
 */
export function createPublicClient() {
  const { url, anonKey } = publicSupabaseEnv();
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
