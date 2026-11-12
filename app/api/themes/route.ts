import { NextResponse } from 'next/server';
import { createPublicClient } from '@/lib/supabase/public';
import { THEME_TYPES, createTrackRowsCache, listThemes, type ThemeType } from '@/lib/themes/themes';

/** The catalog changes only on an import: a theme list up to 5 minutes old is fine. */
const CACHE_SECONDS = 300;
const cachedRows = createTrackRowsCache(CACHE_SECONDS * 1000);

/**
 * GET /api/themes?type=artist|genre|decade|random&q=text -> ThemeSummary[]
 * The same for every visitor (no session), so the CDN may serve it and refresh in the background.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  if (type !== null && !(THEME_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: 'INVALID_TYPE' }, { status: 400 });
  }
  try {
    const db = createPublicClient();
    const themes = await listThemes(
      db,
      { type: (type as ThemeType | null) ?? undefined, q: params.get('q') ?? undefined },
      { rows: await cachedRows(db) },
    );
    return NextResponse.json(themes, {
      headers: { 'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600` },
    });
  } catch (err) {
    console.error('GET /api/themes failed:', err);
    return NextResponse.json({ error: 'THEMES_UNAVAILABLE' }, { status: 500 });
  }
}
