import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeVi } from '../text/normalize-vi';
import { decadeFromDate, titleNorm, type DropReason, type FilterResult } from './filter';
import type { ItunesSong } from './itunes';

/**
 * Review file (catalog/review/<artistKey>.json), edited by the curator before import.
 *
 * - `kept`: songs the filter accepted. Set `include: false` to leave one out; edit
 *   `title`, `artist`, `genre`, `decade` freely (title_norm/artist_norm are recomputed on import).
 * - `dropped`: songs the filter rejected, with the `reason`. Set `include: true` to bring one back.
 */
export interface ReviewTrack {
  include: boolean;
  itunesTrackId: number;
  title: string;
  artist: string;
  genre: string | null;
  decade: string | null;
  /** Empty string when iTunes returned no preview; such entries cannot be imported. */
  previewUrl: string;
  coverUrl: string | null;
}
export interface ReviewDropped extends ReviewTrack {
  reason: DropReason;
}
export interface ReviewFile {
  version: 1;
  artistKey: string;
  note: string;
  kept: ReviewTrack[];
  dropped: ReviewDropped[];
}

const NOTE =
  'Curator-editable. kept: set include=false to leave a song out; edit title/artist/genre/decade as needed. ' +
  'dropped: set include=true to bring a wrongly dropped song back. Then run the importer on this file.';

/** iTunes artwork URLs end in /100x100bb.jpg; the same path serves larger sizes. */
export function upscaleCover(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\./, '/600x600bb.');
}

export function toReviewTrack(song: ItunesSong, include: boolean): ReviewTrack {
  return {
    include,
    itunesTrackId: song.trackId,
    title: song.trackName,
    artist: song.artistName,
    genre: song.primaryGenreName ?? null,
    decade: decadeFromDate(song.releaseDate),
    previewUrl: song.previewUrl ?? '',
    coverUrl: upscaleCover(song.artworkUrl100),
  };
}

/** Writes `<dir>/<artistKey>.json` (overwrites) and returns its path. */
export function writeReviewFile(artistKey: string, result: FilterResult, dir: string): string {
  const review: ReviewFile = {
    version: 1,
    artistKey,
    note: NOTE,
    kept: result.kept.map((s) => toReviewTrack(s, true)),
    dropped: result.dropped.map((d) => ({ ...toReviewTrack(d.song, false), reason: d.reason })),
  };
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${artistKey}.json`);
  writeFileSync(file, JSON.stringify(review, null, 2) + '\n', 'utf8');
  return file;
}

function parseReview(file: string): ReviewFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read review file ${file}: ${(e as Error).message}`);
  }
  const r = raw as Partial<ReviewFile> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.kept) || !Array.isArray(r.dropped)) {
    throw new Error(`Invalid review file ${file}: expected { kept: [], dropped: [] }`);
  }
  return r as ReviewFile;
}

interface TrackRow {
  itunes_track_id: number;
  preview_url: string;
  title: string;
  title_norm: string;
  artist: string;
  artist_norm: string;
  language: 'vi';
  genre: string | null;
  decade: string | null;
  cover_url: string | null;
}

function blankToNull(v: string | null | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t === '' ? null : t;
}

function toRow(t: ReviewTrack): TrackRow | null {
  const title = blankToNull(t.title);
  const artist = blankToNull(t.artist);
  const previewUrl = blankToNull(t.previewUrl);
  if (!Number.isInteger(t.itunesTrackId) || !title || !artist || !previewUrl) return null;
  return {
    itunes_track_id: t.itunesTrackId,
    preview_url: previewUrl,
    title,
    title_norm: titleNorm(title),
    artist,
    artist_norm: normalizeVi(artist),
    language: 'vi', // ruling R3: the catalog is a curated V-pop artist list
    genre: blankToNull(t.genre),
    decade: blankToNull(t.decade),
    cover_url: blankToNull(t.coverUrl),
  };
}

const CHUNK = 500;

/**
 * Upserts the curator-approved tracks of a review file (kept with include !== false, plus
 * dropped entries the curator set include=true) keyed on itunes_track_id. Re-running is safe;
 * curator edits overwrite what an earlier import stored. Entries that cannot be imported
 * (missing preview/title/artist/id) are counted in `skipped`.
 */
export async function importReviewed(
  file: string,
  db: Pick<SupabaseClient, 'from'>,
): Promise<{ upserted: number; skipped: number }> {
  const review = parseReview(file);
  const approved: ReviewTrack[] = [
    ...review.kept.filter((t) => t.include !== false),
    ...review.dropped.filter((t) => t.include === true),
  ];

  const rows = new Map<number, TrackRow>(); // one row per itunes_track_id (last edit wins)
  let skipped = 0;
  for (const t of approved) {
    const row = toRow(t);
    if (row) rows.set(row.itunes_track_id, row);
    else skipped++;
  }

  const all = [...rows.values()];
  for (let i = 0; i < all.length; i += CHUNK) {
    const { error } = await db
      .from('tracks')
      .upsert(all.slice(i, i + CHUNK), { onConflict: 'itunes_track_id' });
    if (error) throw new Error(`Upsert into tracks failed: ${error.message}`);
  }
  return { upserted: all.length, skipped };
}
