import { defineConfig, devices } from '@playwright/test';
import { localSupabase } from './e2e/supabase-env';

/**
 * Multiplayer e2e against `next dev` + the LOCAL Supabase stack (run `npx supabase start` first).
 * Fixed phases run at half speed (ROOM_TIMING_SCALE, honoured only because E2E=1; see config.ts).
 * Start checks HEAD on real iTunes preview URLs, so the machine needs internet access.
 */
const PORT = 3100;
const supabase = localSupabase();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      E2E: '1',
      ROOM_TIMING_SCALE: '0.5',
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    },
  },
});
