/**
 * V-pop catalog importer (two steps, with a manual review in between).
 *
 *   1. Fetch + filter from iTunes into editable review files (no DB access):
 *        npm run catalog:fetch -- --artist son-tung-m-tp [--artist den-vau ...] | --all
 *          [--limit 200] [--out catalog/review] [--artists catalog/artists.vpop.json] [--force]
 *
 *   Re-file the genre of every artist review file (after changing an artist's "genre" or the rules in
 *   lib/catalog/genre.ts; curator edits to `genre` are overwritten, collection files are skipped):
 *        tsx scripts/catalog/import-itunes.ts --reclassify [--out catalog/review]
 *
 *   2. After editing catalog/review/<artistKey>.json, import it into a database:
 *        npm run catalog:import -- catalog/review/son-tung-m-tp.json --target local|staging|prod [--yes]
 *      (same as: tsx scripts/catalog/import-itunes.ts --import <file> --target <t>)
 *
 * Targets (secrets are read from the environment and never printed):
 *   local    `npx supabase status -o env`
 *   staging  CATALOG_STAGING_SUPABASE_URL + CATALOG_STAGING_SERVICE_ROLE_KEY
 *   prod     CATALOG_PROD_SUPABASE_URL + CATALOG_PROD_SERVICE_ROLE_KEY
 * staging/prod additionally require --yes. Import also: kept songs with include:false are deleted from
 * tracks; tracks.artist_keys is filled from --artists (default catalog/artists.vpop.json) and merged.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadArtists } from '../../lib/catalog/artists';
import { filterSongs } from '../../lib/catalog/filter';
import { searchItunes, type ItunesSong } from '../../lib/catalog/itunes';
import { importReviewed, reclassifyReview, writeReviewFile, type ReviewFile } from '../../lib/catalog/review';
import { createCatalogClient, parseTarget, resolveTarget } from '../../lib/catalog/target';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ITUNES_DELAY_MS = 3000; // iTunes Search throttles at roughly 20 requests/minute

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      artist: { type: 'string', multiple: true },
      all: { type: 'boolean', default: false },
      limit: { type: 'string', default: '200' },
      out: { type: 'string', default: 'catalog/review' },
      artists: { type: 'string', default: 'catalog/artists.vpop.json' },
      force: { type: 'boolean', default: false },
      import: { type: 'string' },
      target: { type: 'string' },
      yes: { type: 'boolean', default: false },
      reclassify: { type: 'boolean', default: false },
    },
  });

  if (values.reclassify) {
    const artists = loadArtists(values.artists!);
    const reviews = readdirSync(values.out!)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(values.out!, name))
      .map((file) => ({ file, review: JSON.parse(readFileSync(file, 'utf8')) as ReviewFile }));
    // Songs of a collection (TV show, Tết classics) keep its genre wherever else they appear.
    const collectionGenres = new Map<number, string>();
    for (const { review } of reviews) {
      if (review.artistKey) continue;
      for (const t of review.kept) if (t.include && t.genre) collectionGenres.set(t.itunesTrackId, t.genre);
    }
    let changed = 0;
    for (const { file, review } of reviews) {
      const next = reclassifyReview(review, artists, collectionGenres);
      if (next === review) continue; // collection file
      writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      changed++;
    }
    console.log(`Re-filed the genre of ${changed} review file(s) in ${values.out}.`);
    return;
  }

  if (values.import !== undefined) {
    // `npm run catalog:import -- <file>` puts the file right after --import; also accept a positional.
    const file = values.import || positionals[0];
    if (!file) throw new Error('--import needs a review file path');
    const target = parseTarget(values.target);
    if (target !== 'local' && !values.yes) {
      throw new Error(`Refusing to write to ${target} without --yes`);
    }
    const cfg = resolveTarget(target);
    console.log(`Importing ${file} into ${target} (${new URL(cfg.url).host})`);
    const { upserted, skipped, deleted } = await importReviewed(
      file,
      createCatalogClient(cfg),
      loadArtists(values.artists!),
    );
    console.log(
      `Upserted ${upserted} track(s), deleted ${deleted} excluded track(s)` +
        `${skipped ? `, skipped ${skipped} without preview/title/artist` : ''}.`,
    );
    return;
  }

  const artists = loadArtists(values.artists!);
  const wanted = values.all ? artists : (values.artist ?? []).map((key) => {
    const a = artists.find((x) => x.key === key);
    if (!a) throw new Error(`Unknown artist key "${key}". Known: ${artists.map((x) => x.key).join(', ')}`);
    return a;
  });
  if (wanted.length === 0) throw new Error('Nothing to do: pass --artist <key> (repeatable), --all, or --import <file>.');

  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('--limit must be an integer 1..200');

  let first = true;
  const failed: string[] = [];
  for (const artist of wanted) {
    const file = path.join(values.out!, `${artist.key}.json`);
    if (existsSync(file) && !values.force) {
      console.log(`${artist.key}: ${file} already exists (curated?) - skipping, use --force to overwrite`);
      continue;
    }
    const byId = new Map<number, ItunesSong>();
    try {
      for (const term of [artist.name, ...(artist.searchTerms ?? [])]) {
        if (!first) await sleep(ITUNES_DELAY_MS);
        first = false;
        for (const s of await searchItunes(term, { limit })) if (!byId.has(s.trackId)) byId.set(s.trackId, s);
      }
    } catch (e) {
      // One artist failing (after searchItunes' own retries) must not throw away the rest of --all.
      console.error(`${artist.key}: ${e instanceof Error ? e.message : e} - skipped, re-run with --artist ${artist.key}`);
      failed.push(artist.key);
      continue;
    }
    const result = filterSongs([...byId.values()], artist);
    const written = writeReviewFile(artist.key, result, values.out!, artists);
    const reasons = result.dropped.reduce<Record<string, number>>((acc, d) => {
      acc[d.reason] = (acc[d.reason] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `${artist.key}: ${byId.size} hits, kept ${result.kept.length}, dropped ${result.dropped.length} ` +
        `${JSON.stringify(reasons)} -> ${written}`,
    );
  }
  console.log('Review the files, then import with: npm run catalog:import -- <file> --target local');
  if (failed.length > 0) {
    console.error(`Failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
