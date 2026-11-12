import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeVi } from '../text/normalize-vi';
import { loadArtists } from './artists';
import { classifyGenre } from './genre';
import {
  periodOfYear,
  releaseYearFromDate,
  TET_GENRE,
  matchesArtist,
  titleNorm,
  type Artist,
  type DropReason,
  type FilterResult,
} from './filter';
import type { ItunesSong } from './itunes';

/**
 * Review file (catalog/review/<artistKey>.json), edited by the curator before import.
 * A collection file (e.g. catalog/review/tet-classics.json) has `collection` instead of
 * `artistKey`: hand-picked songs by any singer, tagged only with the curated artists they credit.
 *
 * - `kept`: songs the filter accepted. Set `include: false` to leave one out; edit
 *   `title`, `artist`, `genre`, `releaseYear` freely (title_norm/artist_norm and the 5-year
 *   release period are recomputed on import). Fix `releaseYear` when iTunes dates a re-release.
 * - `dropped`: songs the filter rejected, with the `reason`. Set `include: true` to bring one back.
 */
export interface ReviewTrack {
  include: boolean;
  itunesTrackId: number;
  title: string;
  artist: string;
  /** "Thể loại" (lib/catalog/genre.ts); curator-editable, recomputed only by reclassifyReview. */
  genre: string | null;
  /** iTunes primaryGenreName as fetched: input to the genre classifier, never imported. */
  itunesGenre?: string | null;
  /** Year of the original release (iTunes date by default; correct it for re-releases). */
  releaseYear: number | null;
  /** Empty string when iTunes returned no preview; such entries cannot be imported. */
  previewUrl: string;
  coverUrl: string | null;
}
export interface ReviewDropped extends ReviewTrack {
  reason: DropReason;
}
export interface ReviewFile {
  version: 1;
  /** The curated artist this file was fetched for; absent in a collection file. */
  artistKey?: string;
  /** Name of a hand-picked collection (no single artist); set instead of `artistKey`. */
  collection?: string;
  note: string;
  kept: ReviewTrack[];
  dropped: ReviewDropped[];
}

const NOTE =
  'Curator-editable. kept: set include=false to leave a song out; edit title/artist/genre/releaseYear as needed. ' +
  'dropped: set include=true to bring a wrongly dropped song back. Then run the importer on this file.';

/** iTunes artwork URLs end in /100x100bb.jpg; the same path serves larger sizes. */
export function upscaleCover(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\./, '/600x600bb.');
}

export function toReviewTrack(
  song: ItunesSong,
  include: boolean,
  artists: Artist[] = [],
  fileArtistKey?: string,
): ReviewTrack {
  const itunesGenre = song.primaryGenreName ?? null;
  return {
    include,
    itunesTrackId: song.trackId,
    title: song.trackName,
    artist: song.artistName,
    genre: classifyGenre({ title: song.trackName, artist: song.artistName, itunesGenre }, artists, fileArtistKey),
    itunesGenre,
    releaseYear: releaseYearFromDate(song.releaseDate),
    previewUrl: song.previewUrl ?? '',
    coverUrl: upscaleCover(song.artworkUrl100),
  };
}

/** Writes `<dir>/<artistKey>.json` (overwrites) and returns its path. */
export function writeReviewFile(
  artistKey: string,
  result: FilterResult,
  dir: string,
  artists: Artist[] = [],
): string {
  const review: ReviewFile = {
    version: 1,
    artistKey,
    note: NOTE,
    kept: result.kept.map((s) => toReviewTrack(s, true, artists, artistKey)),
    dropped: result.dropped.map((d) => ({ ...toReviewTrack(d.song, false, artists, artistKey), reason: d.reason })),
  };
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${artistKey}.json`);
  writeFileSync(file, JSON.stringify(review, null, 2) + '\n', 'utf8');
  return file;
}

/**
 * Re-files every entry of an artist review file with classifyGenre (after the genre rules or an
 * artist's main genre change). The iTunes label is remembered in `itunesGenre` the first time, so
 * running it again gives the same result. Collection files are hand-curated and left alone.
 */
export function reclassifyReview(review: ReviewFile, artists: Artist[]): ReviewFile {
  if (!review.artistKey) return review;
  const refile = <T extends ReviewTrack>(t: T): T => {
    // Files written before itunesGenre existed hold the iTunes label in `genre`, except Tết (ours).
    const itunesGenre = t.itunesGenre !== undefined ? t.itunesGenre : t.genre === TET_GENRE ? null : t.genre;
    const genre = classifyGenre({ title: t.title, artist: t.artist, itunesGenre }, artists, review.artistKey);
    return { ...t, genre, itunesGenre };
  };
  return { ...review, kept: review.kept.map(refile), dropped: review.dropped.map(refile) };
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
  // Hand edits: a wrong type here would silently import (include: "false" is truthy) or store a bad key.
  const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  const isCollection = r.artistKey === undefined && nonEmpty(r.collection);
  if (!isCollection && !nonEmpty(r.artistKey)) {
    throw new Error(
      `Invalid review file ${file}: artistKey must be a non-empty string (or, for a collection file, set collection instead)`,
    );
  }
  for (const [list, entries] of [['kept', r.kept], ['dropped', r.dropped]] as const) {
    entries.forEach((t: unknown, i) => {
      const include = (t as { include?: unknown } | null)?.include;
      if (typeof t !== 'object' || t === null || typeof include !== 'boolean') {
        throw new Error(`Invalid review file ${file}: ${list}[${i}].include must be true or false`);
      }
      const year = (t as { releaseYear?: unknown }).releaseYear;
      if (year !== undefined && year !== null && !Number.isInteger(year)) {
        throw new Error(`Invalid review file ${file}: ${list}[${i}].releaseYear must be a whole year or null`);
      }
    });
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
  artist_keys: string[];
}

function blankToNull(v: string | null | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t === '' ? null : t;
}

function toRow(t: ReviewTrack, fileKey: string | null, curated: Artist[]): TrackRow | null {
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
    decade: periodOfYear(t.releaseYear),
    cover_url: blankToNull(t.coverUrl),
    // every curated artist credited on the track, plus the artist this review file belongs to
    artist_keys: [
      ...new Set([
        ...(fileKey ? [fileKey] : []),
        ...curated.filter((a) => matchesArtist({ artistName: artist }, a)).map((a) => a.key),
      ]),
    ],
  };
}

const CHUNK = 500;
const DEFAULT_ARTISTS_FILE = path.join(process.cwd(), 'catalog', 'artists.vpop.json');

/**
 * Applies a curator-edited review file to `tracks`, keyed on itunes_track_id:
 * - kept entries with include !== false, and dropped entries the curator set include=true, are
 *   upserted. `artist_keys` = curated artists credited on the track + this file's artist key,
 *   UNIONED with the keys already stored (so a second artist's file never removes a key).
 * - kept entries with include === false are DELETED from `tracks` (ruling R3c). Dropped entries
 *   (include:false by default) never delete anything.
 * Re-running is safe; curator edits overwrite what an earlier import stored. Entries that cannot
 * be imported (missing preview/title/artist/id) are counted in `skipped`. Deleting a track that a
 * past game still references fails with a descriptive error (room_rounds.track_id has no cascade).
 */
export async function importReviewed(
  file: string,
  db: Pick<SupabaseClient, 'from'>,
  artists: Artist[] = loadArtists(DEFAULT_ARTISTS_FILE),
): Promise<{ upserted: number; skipped: number; deleted: number }> {
  const review = parseReview(file);
  const approved: ReviewTrack[] = [
    ...review.kept.filter((t) => t.include !== false),
    ...review.dropped.filter((t) => t.include === true),
  ];

  const rows = new Map<number, TrackRow>(); // one row per itunes_track_id (last edit wins)
  let skipped = 0;
  for (const t of approved) {
    const row = toRow(t, review.artistKey ?? null, artists);
    if (row) rows.set(row.itunes_track_id, row);
    else skipped++;
  }

  const all = [...rows.values()];
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const { data: existing, error: readError } = await db
      .from('tracks')
      .select('itunes_track_id, artist_keys')
      .in('itunes_track_id', chunk.map((r) => r.itunes_track_id));
    if (readError) throw new Error(`Reading existing tracks failed: ${readError.message}`);
    const stored = new Map<number, string[]>(
      (existing ?? []).map((r) => [Number(r.itunes_track_id), r.artist_keys as string[]]),
    );
    for (const row of chunk) {
      row.artist_keys = [...new Set([...(stored.get(row.itunes_track_id) ?? []), ...row.artist_keys])].sort();
    }
    const { error } = await db.from('tracks').upsert(chunk, { onConflict: 'itunes_track_id' });
    if (error) throw new Error(`Upsert into tracks failed: ${error.message}`);
  }

  const removeIds = [
    ...new Set(
      review.kept
        .filter((t) => t.include === false && Number.isInteger(t.itunesTrackId))
        .map((t) => t.itunesTrackId),
    ),
  ].filter((id) => !rows.has(id));
  let deleted = 0;
  for (let i = 0; i < removeIds.length; i += CHUNK) {
    const { data, error } = await db
      .from('tracks')
      .delete()
      .in('itunes_track_id', removeIds.slice(i, i + CHUNK))
      .select('itunes_track_id');
    if (error) throw new Error(`Deleting excluded tracks failed: ${error.message}`);
    deleted += data?.length ?? 0;
  }
  return { upserted: all.length, skipped, deleted };
}
