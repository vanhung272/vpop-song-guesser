/**
 * Genre ("Thể loại") of a catalog track. iTunes files Vietnamese songs under whatever its label
 * reported (Đan Nguyên as "Country", show songs as "K-Pop", most as "Pop"/"Worldwide"/"Asia"), so
 * the genre comes from, in order:
 *   1. the title: Tết/spring songs -> Nhạc Xuân & Tết; film songs -> Nhạc phim (OST);
 *   2. a specific iTunes label (rap, R&B, dance, indie/rock), only for an artist whose own main
 *      genre is a modern one (the labels on bolero / old-music / jazz singers are noise);
 *   3. the main genre of the first credited curated artist (catalog/artists.vpop.json "genre"),
 *      then of the review file's artist, then V-Pop.
 */
import { TET_GENRE, creditedArtists, isTetSong, matchKey, type Artist } from './filter';

export const GENRE_LABELS = {
  vpop: 'V-Pop',
  ballad: 'Ballad',
  bolero: 'Bolero / Trữ tình',
  xua: 'Nhạc xưa / Nhạc Trịnh',
  jazz: 'Jazz / Dân gian đương đại',
  rap: 'Rap / Hip-hop',
  rnb: 'R&B',
  indie: 'Indie / Alternative',
  edm: 'EDM / Dance',
  ost: 'Nhạc phim (OST)',
} as const;
export type GenreKey = keyof typeof GENRE_LABELS;

export const isGenreKey = (v: unknown): v is GenreKey => typeof v === 'string' && v in GENRE_LABELS;

/** iTunes labels specific enough to trust (lowercased). Everything else falls through to the artist. */
const ITUNES_GENRES: Record<string, GenreKey> = {
  'hip-hop/rap': 'rap',
  'hip-hop': 'rap',
  'hip hop': 'rap',
  rap: 'rap',
  'alternative rap': 'rap',
  'r&b/soul': 'rnb',
  'r&b': 'rnb',
  soul: 'rnb',
  'contemporary r&b': 'rnb',
  dance: 'edm',
  electronic: 'edm',
  electronica: 'edm',
  house: 'edm',
  'deep house': 'edm',
  'afro house': 'edm',
  techno: 'edm',
  trance: 'edm',
  breakbeat: 'edm',
  garage: 'edm',
  alternative: 'indie',
  'indie pop': 'indie',
  'indie rock': 'indie',
  rock: 'indie',
  'alternative folk': 'indie',
  psychedelic: 'indie',
  emo: 'indie',
  'folk-rock': 'indie',
  'korean rock': 'indie',
  metal: 'indie',
  punk: 'indie',
};

/** Main genres whose singers' iTunes labels are not trusted (step 2 is skipped for them). */
const TRADITIONAL: ReadonlySet<GenreKey> = new Set(['bolero', 'xua', 'jazz']);

const OST_RE = /\bost\b|nhac phim|soundtrack/;

export interface GenreInput {
  title: string;
  /** Full iTunes credit, e.g. "Đen & MIN". */
  artist: string;
  /** iTunes primaryGenreName as fetched. */
  itunesGenre: string | null;
}

/** Main genre of the first curated artist credited on the track (credit order), if any. */
function firstCreditedGenre(artist: string, artists: Artist[]): GenreKey | undefined {
  for (const credit of [matchKey(artist), ...creditedArtists(artist)]) {
    const found = artists.find((a) => [a.name, ...(a.aliases ?? [])].some((n) => matchKey(n) === credit));
    if (found && isGenreKey(found.genre)) return found.genre;
  }
  return undefined;
}

/** The genre label stored in tracks.genre for one track (see the module comment for the rules). */
export function classifyGenre(t: GenreInput, artists: Artist[], fileArtistKey?: string): string {
  if (isTetSong(t.title)) return TET_GENRE;
  if (OST_RE.test(matchKey(t.title))) return GENRE_LABELS.ost;

  const fileArtist = artists.find((a) => a.key === fileArtistKey);
  const main: GenreKey =
    firstCreditedGenre(t.artist, artists) ?? (isGenreKey(fileArtist?.genre) ? fileArtist.genre : 'vpop');
  const labelled = t.itunesGenre ? ITUNES_GENRES[t.itunesGenre.trim().toLowerCase()] : undefined;
  return GENRE_LABELS[labelled && !TRADITIONAL.has(main) ? labelled : main];
}
