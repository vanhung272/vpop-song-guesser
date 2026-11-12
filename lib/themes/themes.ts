import type { SupabaseClient } from '@supabase/supabase-js';
import artistsJson from '@/catalog/artists.vpop.json';
import { parseArtists } from '@/lib/catalog/artists';
import type { Artist } from '@/lib/catalog/filter';
import { QUESTION_COUNT_OPTIONS } from '@/lib/rooms/config';
import { normalizeVi } from '@/lib/text/normalize-vi';
import { themeParts, type ThemeType } from './mix';

// The theme vocabulary and mix helpers live in ./mix (safe for client bundles); re-exported here.
export { MIX_MAX_PARTS, MIXABLE_TYPES, THEME_TYPES, isValidMix, mixTheme, themeParts } from './mix';
export type { PickableThemeType, ThemeRefLike, ThemeType } from './mix';

export interface ThemeSummary {
  type: ThemeType;
  /**
   * artist: curated artist key; genre: genre value; decade: 5-year release period (e.g. "2015-2019");
   * random: always RANDOM_THEME_KEY (every track); mix: canonical "type:key|type:key" (see mixTheme).
   */
  key: string;
  label: string;
  trackCount: number;
  /** Enough tracks for the largest selectable question count. */
  playable: boolean;
  /** Artist themes: other spellings of the name, so a client can search the list itself. */
  aliases?: string[];
}

export interface ListThemesOptions {
  type?: ThemeType;
  q?: string;
}

/** Minimum tracks a theme needs so any question count can be chosen. */
export const PLAYABLE_MIN_TRACKS = Math.max(...QUESTION_COUNT_OPTIONS);

const PAGE_SIZE = 1000; // PostgREST default max-rows

/** The one key of the 'random' theme, which plays songs from the whole catalog. */
export const RANDOM_THEME_KEY = 'all';
const RANDOM_LABEL = 'Ngẫu nhiên';

const curatedArtists: Artist[] = parseArtists(artistsJson);

export interface TrackRow {
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

/**
 * The theme columns of the whole catalog, read at most once per `ttlMs` (concurrent callers share
 * one read; a failed read is not kept). The catalog only changes on an import, so a theme list a
 * few minutes old is fine, and it spares reading every track on each tab switch.
 */
export function createTrackRowsCache(ttlMs: number) {
  let entry: { at: number; rows: Promise<TrackRow[]> } | null = null;
  return (db: SupabaseClient, nowMs: number = Date.now()): Promise<TrackRow[]> => {
    if (!entry || nowMs - entry.at >= ttlMs) {
      const rows = fetchTrackRows(db);
      const mine = { at: nowMs, rows };
      entry = mine;
      rows.catch(() => {
        if (entry === mine) entry = null;
      });
    }
    return entry.rows;
  };
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
  { artists = curatedArtists, rows: given }: { artists?: Artist[]; rows?: TrackRow[] } = {},
): Promise<ThemeSummary[]> {
  const rows = given ?? (await fetchTrackRows(db));
  const needle = q ? normalizeVi(q) : '';
  const matches = (...texts: string[]) =>
    needle === '' || texts.some((t) => normalizeVi(t).includes(needle));

  const out: ThemeSummary[] = [];
  const push = (t: ThemeType, key: string, label: string, trackCount: number, aliases?: string[]) => {
    if (trackCount > 0) {
      const theme: ThemeSummary = { type: t, key, label, trackCount, playable: trackCount >= PLAYABLE_MIN_TRACKS };
      if (aliases?.length) theme.aliases = aliases;
      out.push(theme);
    }
  };

  if (!type || type === 'artist') {
    const counts = new Map<string, number>();
    for (const r of rows) for (const k of new Set(r.artist_keys ?? [])) bump(counts, k);
    for (const a of artists) {
      if (matches(a.name, a.key, ...(a.aliases ?? []))) {
        push('artist', a.key, a.name, counts.get(a.key) ?? 0, a.aliases);
      }
    }
  }
  if ((!type || type === 'random') && matches(RANDOM_LABEL, 'tat ca')) {
    push('random', RANDOM_THEME_KEY, RANDOM_LABEL, rows.length);
  }
  for (const t of ['genre', 'decade'] as const) {
    if (type && type !== t) continue;
    const counts = new Map<string, number>();
    for (const r of rows) bump(counts, r[t]);
    for (const [value, n] of counts) {
      const label = t === 'decade' ? periodLabel(value) : value;
      if (matches(value, label)) push(t, value, label, n);
    }
  }

  return out.sort(
    (a, b) =>
      Number(b.playable) - Number(a.playable) ||
      // Release periods read best newest-first; everything else by size.
      (type === 'decade' ? b.key.localeCompare(a.key) : 0) ||
      b.trackCount - a.trackCount ||
      a.label.localeCompare(b.label, 'vi'),
  );
}

const PERIOD_RE = /^(\d{4})-(\d{4})$/;

/** "2015-2019" -> "2015 – 2019"; the period containing `currentYear` ends in "nay" (now). */
export function periodLabel(key: string, currentYear = new Date().getFullYear()): string {
  const m = PERIOD_RE.exec(key);
  if (!m) return key;
  return Number(m[2]) >= currentYear ? `${m[1]} – nay` : `${m[1]} – ${m[2]}`;
}

/** Display label of a theme: the curated artist name for artist themes, otherwise the key itself. */
export function themeLabel(
  theme: Pick<ThemeSummary, 'type' | 'key'>,
  { artists = curatedArtists }: { artists?: Artist[] } = {},
): string {
  if (theme.type === 'artist') return artists.find((a) => a.key === theme.key)?.name ?? theme.key;
  if (theme.type === 'decade') return periodLabel(theme.key);
  if (theme.type === 'random') return RANDOM_LABEL;
  if (theme.type === 'mix') return themeParts(theme).map((p) => themeLabel(p, { artists })).join(' + ');
  return theme.key;
}
