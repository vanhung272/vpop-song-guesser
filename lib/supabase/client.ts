import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicSupabaseEnv } from './env';

let browserClient: SupabaseClient | undefined;

/** Browser Supabase client (anon key; session kept in cookies so route handlers see it). */
export function createClient(): SupabaseClient {
  if (!browserClient) {
    const { url, anonKey } = publicSupabaseEnv();
    browserClient = createBrowserClient(url, anonKey);
  }
  return browserClient;
}

/**
 * Returns the current user id, signing in anonymously on the first visit.
 * Requires "Anonymous sign-ins" enabled in the Supabase project.
 */
export async function ensureAnonymousSession(client: SupabaseClient = createClient()): Promise<string> {
  const { data } = await client.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signedIn, error } = await client.auth.signInAnonymously();
  if (error || !signedIn.user) throw new Error(`anonymous sign-in failed: ${error?.message ?? 'no user'}`);
  return signedIn.user.id;
}

/**
 * Replaces a session the server rejects (e.g. the user no longer exists after a project reset)
 * with a fresh anonymous one. Local sign-out only: the rejected token has nothing to revoke.
 */
export async function resetAnonymousSession(client: SupabaseClient = createClient()): Promise<string> {
  await client.auth.signOut({ scope: 'local' });
  const { data: signedIn, error } = await client.auth.signInAnonymously();
  if (error || !signedIn.user) throw new Error(`anonymous sign-in failed: ${error?.message ?? 'no user'}`);
  return signedIn.user.id;
}
