-- Ruling R7g: hide tracks.preview_url from clients.
-- The room snapshot gives players the current round's preview URL (for preloading) before the
-- answer is revealed. If anon/authenticated could read or filter tracks.preview_url, a client
-- could look up `tracks?preview_url=eq.<url>` and read the title/artist during the question.
--
-- Replace the table-level SELECT grant with column-level SELECT on every column except
-- preview_url. Postgres also requires SELECT on a column to use it in WHERE, so filtering by
-- preview_url is denied too. The RLS select policy (tracks_select_public) is unchanged.
-- Columns added later are NOT readable by clients until granted explicitly here.
-- service_role keeps full access (granted in 0001).

revoke select on public.tracks from anon, authenticated;

grant select (
  id,
  itunes_track_id,
  title,
  title_norm,
  artist,
  artist_norm,
  language,
  genre,
  decade,
  cover_url,
  artist_keys
) on public.tracks to anon, authenticated;
