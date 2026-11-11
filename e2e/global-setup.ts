import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { periodOfYear } from '../lib/catalog/filter';
import { normalizeVi } from '../lib/text/normalize-vi';
import { localSupabase } from './supabase-env';

/** e2e plays the artist theme of this fixture (title questions only, so 4 distinct titles per round). */
export const E2E_ARTIST_KEY = 'den-vau';

interface ItunesTrack {
  kind?: string;
  trackId: number;
  trackName: string;
  artistName: string;
  previewUrl?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
}

/** Seeds the local catalog with the iTunes fixture of one curated artist (idempotent). */
export default async function globalSetup() {
  const env = localSupabase();
  const db = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
  const file = join(__dirname, '..', 'lib', 'catalog', '__fixtures__', `${E2E_ARTIST_KEY}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8')) as { results: ItunesTrack[] };
  const seen = new Set<string>();
  const rows = [];
  for (const t of json.results) {
    const titleNorm = normalizeVi(t.trackName);
    if (t.kind !== 'song' || !t.previewUrl || seen.has(titleNorm)) continue;
    seen.add(titleNorm);
    const year = Number(String(t.releaseDate ?? '').slice(0, 4));
    rows.push({
      itunes_track_id: t.trackId,
      preview_url: t.previewUrl,
      title: t.trackName,
      title_norm: titleNorm,
      artist: t.artistName,
      artist_norm: normalizeVi(t.artistName),
      language: 'vi',
      genre: t.primaryGenreName ?? null,
      decade: Number.isFinite(year) && year > 0 ? periodOfYear(year) : null,
      cover_url: t.artworkUrl100 ?? null,
      artist_keys: [E2E_ARTIST_KEY],
    });
  }
  const { error } = await db.from('tracks').upsert(rows, { onConflict: 'itunes_track_id' });
  if (error) throw new Error(`seeding e2e catalog failed: ${error.message}`);
}
