/**
 * Minimal iTunes Search API client. Always searches the VN store for songs
 * (country=VN&media=music&entity=song); audio is only ever the iTunes preview.
 */
export interface ItunesSong {
  trackId: number;
  trackName: string;
  artistName: string;
  previewUrl?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  collectionName?: string;
}

export const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const DEFAULT_LIMIT = 50;

function isSong(r: unknown): r is ItunesSong {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.trackId === 'number' && typeof o.trackName === 'string' && typeof o.artistName === 'string'
  );
}

export async function searchItunes(
  term: string,
  { limit = DEFAULT_LIMIT }: { limit?: number } = {},
  fetchFn: typeof fetch = fetch,
): Promise<ItunesSong[]> {
  const url = new URL(ITUNES_SEARCH_URL);
  // URLSearchParams percent-encodes the term as UTF-8 (Vietnamese diacritics included).
  url.search = new URLSearchParams({
    term,
    country: 'VN',
    media: 'music',
    entity: 'song',
    limit: String(limit),
  }).toString();

  const res = await fetchFn(url.toString());
  if (!res.ok) {
    const status = [res.status, res.statusText].filter(Boolean).join(' ');
    throw new Error(`iTunes search failed: HTTP ${status} for term "${term}"`);
  }
  const body: unknown = await res.json();
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) {
    throw new Error(`iTunes search returned an unexpected response for term "${term}"`);
  }
  return results.filter(isSong);
}
