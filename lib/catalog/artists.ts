import { readFileSync } from 'node:fs';
import type { Artist } from './filter';

/**
 * catalog/artists.vpop.json is a JSON array of curated V-pop artists:
 *   [{ "key": "son-tung-m-tp",          // unique slug, also the review file name
 *      "name": "Sơn Tùng M-TP",         // searched on iTunes and accepted as a credit
 *      "aliases": ["Son Tung M-TP"],    // other spellings iTunes uses (optional)
 *      "searchTerms": ["M-TP"] }]       // extra iTunes search terms (optional)
 * A song matches when the artist (name or alias; diacritics, case and punctuation ignored) is one of
 * its credited artists: "A", "A & B", "A, B", "A feat. B", "A x B".
 */
export function parseArtists(raw: unknown): Artist[] {
  if (!Array.isArray(raw)) throw new Error('artists file must be a JSON array');
  const keys = new Set<string>();
  return raw.map((a, i) => {
    const o = a as Partial<Artist> | null;
    if (!o || typeof o.key !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.key)) {
      throw new Error(`artists[${i}]: "key" must be a lowercase slug`);
    }
    if (typeof o.name !== 'string' || o.name.trim() === '') {
      throw new Error(`artists[${i}]: "name" is required`);
    }
    for (const f of ['aliases', 'searchTerms'] as const) {
      const v = o[f];
      if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) {
        throw new Error(`artists[${i}]: "${f}" must be an array of strings`);
      }
    }
    if (keys.has(o.key)) throw new Error(`artists[${i}]: duplicate key "${o.key}"`);
    keys.add(o.key);
    return o as Artist;
  });
}

export function loadArtists(file: string): Artist[] {
  return parseArtists(JSON.parse(readFileSync(file, 'utf8')));
}
