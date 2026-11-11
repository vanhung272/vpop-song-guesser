import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | undefined;

/** Browser Supabase client (anon key; session kept in cookies so route handlers see it). */
export function createClient(): SupabaseClient {
  browserClient ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
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
