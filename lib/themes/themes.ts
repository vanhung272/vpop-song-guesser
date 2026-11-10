import type { SupabaseClient } from '@supabase/supabase-js';
import artistsJson from '@/catalog/artists.vpop.json';
import { parseArtists } from '@/lib/catalog/artists';
import type { Artist } from '@/lib/catalog/filter';
import { QUESTION_COUNT_OPTIONS } from '@/lib/rooms/config';
import { normalizeVi } from '@/lib/text/normalize-vi';

export const THEME_TYPES = ['artist', 'genre', 'decade'] as const;
export type ThemeType = (typeof THEME_TYPES)[number];

export interface ThemeSummary {
  type: ThemeType;
  /** artist: curated artist key; genre: genre value; decade: decade value (e.g. "2010s"). */
  key: string;
  label: string;
  trackCount: number;
  /** Enough tracks for the largest selectable question count. */
  playable: boolean;
}

export interface ListThemesOptions {
  type?: ThemeType;
  q?: string;
}

/** Minimum tracks a theme needs so any question count can be chosen. */
export const PLAYABLE_MIN_TRACKS = Math.max(...QUESTION_COUNT_OPTIONS);

const PAGE_SIZE = 1000; // PostgREST default max-rows

const curatedArtists: Artist[] = parseArtists(artistsJson);

interface TrackRow {
  artist_keys: string[] | null;
  genre: string | null;
  decade: string | null;
}

/** Reads the three theme columns of every Vietnamese track, paging past the 1000-row API cap. */
async function fetchTrackRows(db: SupabaseClient): Promise<TrackRow[]> {
  const rows: TrackRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('tracks')
      .select('artist_keys, genre, decade')
      .eq('language', 'vi')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`listThemes: ${error.message}`);
    rows.push(...(data as TrackRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function bump(map: Map<string, number>, key: string | null | undefined) {
  if (key) map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Lists browsable themes (artist / genre / decade) with the number of Vietnamese tracks in each.
 * Only themes with at least one track are returned; sorted playable first, then trackCount desc,
 * then label. `q` filters by normalizeVi substring on the label (artists: also aliases and key).
 * Aggregation happens here rather than in SQL: the catalog is a few thousand tracks, so three
 * narrow columns are cheap to read and no extra DB surface (view/function) is needed.
 */
export async function listThemes(
  db: SupabaseClient,
  { type, q }: ListThemesOptions = {},
  { artists = curatedArtists }: { artists?: Artist[] } = {},
): Promise<ThemeSummary[]> {
  const rows = await fetchTrackRows(db);
  const needle = q ? normalizeVi(q) : '';
  const matches = (...texts: string[]) =>
    needle === '' || texts.some((t) => normalizeVi(t).includes(needle));

  const out: ThemeSummary[] = [];
  const push = (t: ThemeType, key: string, label: string, trackCount: number) => {
    if (trackCount > 0) {
      out.push({ type: t, key, label, trackCount, playable: trackCount >= PLAYABLE_MIN_TRACKS });
    }
  };

  if (!type || type === 'artist') {
    const counts = new Map<string, number>();
    for (const r of rows) for (const k of new Set(r.artist_keys ?? [])) bump(counts, k);
    for (const a of artists) {
      if (matches(a.name, a.key, ...(a.aliases ?? []))) {
        push('artist', a.key, a.name, counts.get(a.key) ?? 0);
      }
    }
  }
  for (const t of ['genre', 'decade'] as const) {
    if (type && type !== t) continue;
    const counts = new Map<string, number>();
    for (const r of rows) bump(counts, r[t]);
    for (const [value, n] of counts) if (matches(value)) push(t, value, value, n);
  }

  return out.sort(
    (a, b) =>
      Number(b.playable) - Number(a.playable) ||
      b.trackCount - a.trackCount ||
      a.label.localeCompare(b.label, 'vi'),
  );
}
