/**
 * Theme vocabulary and mixed-theme helpers. Pure (no Node or server imports) so client components
 * such as the theme picker can use them; lib/themes/themes.ts re-exports everything here.
 */

export const THEME_TYPES = ['artist', 'genre', 'decade', 'random', 'mix'] as const;
export type ThemeType = (typeof THEME_TYPES)[number];
/** Theme types a host picks from (tabs); a 'mix' is several of these picked together. */
export type PickableThemeType = Exclude<ThemeType, 'mix'>;
/** Types that can be part of a mix ('random' already covers everything). */
export const MIXABLE_TYPES = ['artist', 'genre', 'decade'] as const;

export interface ThemeRefLike {
  type: ThemeType;
  key: string;
}

// ----------------------------------------------------------------------------- mixed themes

/** Most themes one mix may combine. */
export const MIX_MAX_PARTS = 10;
const PART_SEP = '|';

const partKey = (t: ThemeRefLike) => `${t.type}:${t.key}`;

/**
 * Several picked themes as one: songs from any of them (union). No part -> null, one part -> that
 * theme itself, more -> { type: 'mix', key } with the parts deduplicated and sorted, so the same
 * picks always give the same key.
 */
export function mixTheme(parts: ThemeRefLike[]): ThemeRefLike | null {
  const unique = [...new Map(parts.map((p) => [partKey(p), { type: p.type, key: p.key }])).values()];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  return { type: 'mix', key: unique.map(partKey).sort().join(PART_SEP) };
}

/** The picked themes behind `theme`: a mix's parts, a single theme itself, nothing for null. */
export function themeParts(theme: ThemeRefLike | null | undefined): ThemeRefLike[] {
  if (!theme) return [];
  if (theme.type !== 'mix') return [{ type: theme.type, key: theme.key }];
  return theme.key.split(PART_SEP).map((part) => {
    const i = part.indexOf(':');
    return { type: part.slice(0, i) as ThemeType, key: part.slice(i + 1) };
  });
}

/** A valid mix: 2..MIX_MAX_PARTS mixable parts with keys, written in canonical form. */
export function isValidMix(theme: ThemeRefLike): boolean {
  if (theme.type !== 'mix') return false;
  const parts = themeParts(theme);
  return (
    parts.length >= 2 &&
    parts.length <= MIX_MAX_PARTS &&
    parts.every((p) => (MIXABLE_TYPES as readonly string[]).includes(p.type) && p.key !== '') &&
    mixTheme(parts)?.key === theme.key
  );
}
