import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { THEME_TYPES, listThemes, type ThemeType } from '@/lib/themes/themes';

/** GET /api/themes?type=artist|genre|decade&q=text -> ThemeSummary[] */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  if (type !== null && !(THEME_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: 'INVALID_TYPE' }, { status: 400 });
  }
  try {
    const db = await createClient();
    const themes = await listThemes(db, {
      type: (type as ThemeType | null) ?? undefined,
      q: params.get('q') ?? undefined,
    });
    return NextResponse.json(themes);
  } catch {
    return NextResponse.json({ error: 'THEMES_UNAVAILABLE' }, { status: 500 });
  }
}
