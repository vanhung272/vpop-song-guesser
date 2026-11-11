import { normalizeVi } from '../text/normalize-vi';
import type { ItunesSong } from './itunes';

/** A curated V-pop artist (see catalog/artists.vpop.json). */
export interface Artist {
  /** Stable slug, used as the review file name. */
  key: string;
  /** Display name; also searched on iTunes and accepted when matching credits. */
  name: string;
  /** Other spellings iTunes uses for this artist (e.g. without diacritics). */
  aliases?: string[];
  /** Extra iTunes search terms (besides `name`). */
  searchTerms?: string[];
}

export type DropReason = 'wrong-artist' | 'variant' | 'duplicate' | 'no-preview';
export interface DroppedSong {
  song: ItunesSong;
  reason: DropReason;
}
export interface FilterResult {
  kept: ItunesSong[];
  dropped: DroppedSong[];
}

/** Lowercase, no diacritics, punctuation collapsed to spaces: "Sơn Tùng M-TP" -> "son tung m tp". */
export function matchKey(s: string): string {
  return normalizeVi(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Split an iTunes artistName into individual credited artists (as match keys):
 * "A & B", "A, B", "A feat. B", "A ft. B", "A x B", "A; B", "A + B", "A / B".
 */
export function creditedArtists(artistName: string): string[] {
  return artistName
    .split(/\s*[,&;+/]\s*/)
    .flatMap((part) => matchKey(part).split(/\s(?:feat|ft|featuring|vs|x)\s/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function matchesArtist(song: Pick<ItunesSong, 'artistName'>, artist: Artist): boolean {
  const wanted = new Set([artist.name, ...(artist.aliases ?? [])].map(matchKey));
  if (wanted.has(matchKey(song.artistName))) return true;
  return creditedArtists(song.artistName).some((c) => wanted.has(c));
}

// Variant markers are looked for only inside (...), [...] or after " - " so that ordinary titles
// like "Live Forever" or "Beat It" survive; remix/karaoke/instrumental are unambiguous anywhere.
const TAG_VARIANT =
  /\b(remix|live|instrumental|karaoke|beat|acoustic|lofi|lo fi|cover|mashup|version|ver|edit|demo|tour|intro|outro|skit|concert|remaster(?:ed)?|sped up|slowed|reverb|tribute|phien ban|ban live)\b/;
const ANYWHERE_VARIANT = /\b(remix|karaoke|instrumental)\b/;
const LEADING_VARIANT = /^(intro|outro|skit)\b/;

function tagsOf(title: string): string[] {
  const tags: string[] = [];
  for (const m of title.matchAll(/[(\[]([^)\]]*)[)\]]/g)) tags.push(m[1]);
  const dash = title.split(/\s[-–—]\s/);
  tags.push(...dash.slice(1));
  return tags;
}

export function isVariantTitle(title: string): boolean {
  const norm = matchKey(title);
  if (ANYWHERE_VARIANT.test(norm) || LEADING_VARIANT.test(norm)) return true;
  return tagsOf(title).some((t) => TAG_VARIANT.test(matchKey(t)));
}

export function titleNorm(title: string): string {
  return normalizeVi(title);
}

/**
 * Decide which iTunes hits become catalog candidates for `artist`.
 * Reason precedence: wrong-artist > no-preview > variant > duplicate (first by order wins).
 */
export function filterSongs(songs: ItunesSong[], artist: Artist): FilterResult {
  const kept: ItunesSong[] = [];
  const dropped: DroppedSong[] = [];
  const seenTitles = new Set<string>();
  for (const song of songs) {
    let reason: DropReason | null = null;
    if (!matchesArtist(song, artist)) reason = 'wrong-artist';
    else if (!song.previewUrl) reason = 'no-preview';
    else if (isVariantTitle(song.trackName)) reason = 'variant';
    else if (seenTitles.has(titleNorm(song.trackName))) reason = 'duplicate';

    if (reason) dropped.push({ song, reason });
    else {
      seenTitles.add(titleNorm(song.trackName));
      kept.push(song);
    }
  }
  return { kept, dropped };
}

/** "2017-03-01T12:00:00Z" -> 2017; null when missing/invalid. */
export function releaseYearFromDate(releaseDate: string | undefined): number | null {
  if (!releaseDate) return null;
  const year = new Date(releaseDate).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

/**
 * 5-year release period of a year: 2017 -> "2015-2019". Stored in tracks.decade (the column and
 * the 'decade' theme type keep their name; the value is the period). null without a whole year.
 */
export function periodOfYear(year: number | null | undefined): string | null {
  if (year == null || !Number.isInteger(year)) return null;
  const start = Math.floor(year / 5) * 5;
  return `${start}-${start + 4}`;
}

/** Genre given to Tết / spring songs, so they form their own "Thể loại" theme. */
export const TET_GENRE = 'Nhạc Tết';

// Matched on normalizeVi(title): lowercase, no diacritics.
const TET_RE = /\btet\b|giao thua|\bli xi\b|\bnam moi\b|new year|\bxuan\b|^di ve nha\b|ve nha la khoe|phao hoa ruc ro/;
// "xuân" also means youth (xuân thì, thanh xuân) or is one of the four seasons; a "Tet movie"
// soundtrack is film music released for Tết, not a Tết song.
const NOT_TET_RE = /xuan thi|thanh xuan|xuan,? ha,? thu,? dong|\bmovie\b|original soundtrack/;

/** Is this a Tết (Lunar New Year) song, judging by its title? */
export function isTetSong(title: string): boolean {
  const t = normalizeVi(title);
  return TET_RE.test(t) && !NOT_TET_RE.test(t);
}
