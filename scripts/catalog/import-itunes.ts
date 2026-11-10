/**
 * V-pop catalog importer (two steps, with a manual review in between).
 *
 *   1. Fetch + filter from iTunes into editable review files (no DB access):
 *        npm run catalog:fetch -- --artist son-tung-m-tp [--artist den-vau ...] | --all
 *          [--limit 200] [--out catalog/review] [--artists catalog/artists.vpop.json] [--force]
 *
 *   2. After editing catalog/review/<artistKey>.json, import it into a database:
 *        npm run catalog:import -- catalog/review/son-tung-m-tp.json --target local|staging|prod [--yes]
 *      (same as: tsx scripts/catalog/import-itunes.ts --import <file> --target <t>)
 *
 * Targets (secrets are read from the environment and never printed):
 *   local    `npx supabase status -o env`
 *   staging  CATALOG_STAGING_SUPABASE_URL + CATALOG_STAGING_SERVICE_ROLE_KEY
 *   prod     CATALOG_PROD_SUPABASE_URL + CATALOG_PROD_SERVICE_ROLE_KEY
 * staging/prod additionally require --yes.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadArtists } from '../../lib/catalog/artists';
import { filterSongs } from '../../lib/catalog/filter';
import { searchItunes, type ItunesSong } from '../../lib/catalog/itunes';
import { importReviewed, writeReviewFile } from '../../lib/catalog/review';
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
    },
  });

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
    const { upserted, skipped } = await importReviewed(file, createCatalogClient(cfg));
    console.log(`Upserted ${upserted} track(s)${skipped ? `, skipped ${skipped} without preview/title/artist` : ''}.`);
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
  for (const artist of wanted) {
    const file = path.join(values.out!, `${artist.key}.json`);
    if (existsSync(file) && !values.force) {
      console.log(`${artist.key}: ${file} already exists (curated?) - skipping, use --force to overwrite`);
      continue;
    }
    const byId = new Map<number, ItunesSong>();
    for (const term of [artist.name, ...(artist.searchTerms ?? [])]) {
      if (!first) await sleep(ITUNES_DELAY_MS);
      first = false;
      for (const s of await searchItunes(term, { limit })) if (!byId.has(s.trackId)) byId.set(s.trackId, s);
    }
    const result = filterSongs([...byId.values()], artist);
    const written = writeReviewFile(artist.key, result, values.out!);
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
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
