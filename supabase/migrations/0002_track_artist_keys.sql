-- Catalog: curated artist keys credited on each track (ruling R4b).
-- `artist` / `artist_norm` stay the full iTunes credit string ("Đen & MIN"); `artist_keys` lists the
-- keys from catalog/artists.vpop.json that are credited on the track (['den-vau', 'min']), so an
-- artist theme can select tracks with `artist_keys @> array['den-vau']` (GIN indexed).
-- Populated by the catalog importer; readable by anon through the existing table-level grant.
alter table public.tracks
  add column artist_keys text[] not null default '{}';

create index tracks_artist_keys_idx on public.tracks using gin (artist_keys);
