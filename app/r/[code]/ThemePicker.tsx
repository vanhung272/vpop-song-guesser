'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { normalizeVi } from '@/lib/text/normalize-vi';
import type { ThemeRef } from '@/lib/rooms/round-builder';
import { MIX_MAX_PARTS, mixTheme, themeParts, type PickableThemeType } from '@/lib/themes/mix';
import type { ThemeSummary } from '@/lib/themes/themes';

// Insertion order is the tab order (left to right).
const TYPE_LABELS: Record<PickableThemeType, string> = {
  random: 'Ngẫu nhiên',
  artist: 'Ca sĩ',
  genre: 'Thể loại',
  decade: 'Thời gian ra mắt',
};

interface Props {
  current: ThemeRef | null;
  /** Sends the new theme; resolves once the server has answered (true when it accepted it). */
  onPick: (theme: ThemeRef) => Promise<boolean> | void;
}

/** Search on the device: label, key and (artists) other spellings, without case or diacritics. */
function matchesSearch(theme: ThemeSummary, needle: string): boolean {
  if (!needle) return true;
  return [theme.label, theme.key, ...(theme.aliases ?? [])].some((t) => normalizeVi(t).includes(needle));
}

const sameTheme = (a: ThemeRef, b: ThemeRef) => a.type === b.type && a.key === b.key;

/**
 * The picks after clicking `item`: toggles it in or out, keeping at least one pick. "Ngẫu nhiên"
 * already covers every song, so it replaces the other picks and any other pick replaces it.
 * Returns null when the click changes nothing.
 */
function togglePick(picked: ThemeRef[], item: ThemeRef): ThemeRef[] | null {
  if (item.type === 'random') return picked.some((p) => sameTheme(p, item)) ? null : [item];
  const others = picked.filter((p) => p.type !== 'random');
  if (others.some((p) => sameTheme(p, item))) {
    const rest = others.filter((p) => !sameTheme(p, item));
    return rest.length > 0 ? rest : null;
  }
  return others.length < MIX_MAX_PARTS ? [...others, item] : null;
}

/**
 * Host-only theme browser: type tabs plus a search box over GET /api/themes; one or several
 * themes can be picked.
 */
export function ThemePicker({ current, onPick }: Props) {
  // Picks show as selected at once; the server's answer replaces them when every pick has settled.
  const [pending, setPending] = useState<ThemeRef[] | null>(null);
  const inFlight = useRef(0);
  const picked = pending ?? themeParts(current);
  const [type, setType] = useState<PickableThemeType>(
    (picked[0]?.type as PickableThemeType | undefined) ?? 'artist',
  );
  const [q, setQ] = useState('');
  // One request per tab, kept for the life of the picker; search filters it on the device.
  const [lists, setLists] = useState<Partial<Record<PickableThemeType, ThemeSummary[]>>>({});
  const [failed, setFailed] = useState(false);
  const loaded = lists[type];

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await apiFetch<ThemeSummary[]>(`/api/themes?${new URLSearchParams({ type })}`);
      if (cancelled) return;
      setFailed(!res.ok);
      if (!res.ok || !Array.isArray(res.data)) return;
      // Only themes with enough songs for any question count; the rest cannot be picked anyway.
      const playable = res.data.filter((t) => t.playable);
      setLists((prev) => ({ ...prev, [type]: playable }));
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [type, loaded]);

  const needle = normalizeVi(q);
  const themes = loaded?.filter((t) => matchesSearch(t, needle));

  async function pick(item: ThemeRef) {
    const next = togglePick(picked, item);
    const theme = next && mixTheme(next);
    if (!theme || !next) return;
    setPending(next);
    inFlight.current++;
    try {
      await onPick(theme);
    } finally {
      if (--inFlight.current === 0) setPending(null);
    }
  }

  return (
    <div className="theme-picker">
      <div className="tabs" role="tablist">
        {(Object.keys(TYPE_LABELS) as PickableThemeType[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === type}
            className={`tab${t === type ? ' tab--active' : ''}`}
            onClick={() => {
              setType(t);
              setQ('');
            }}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {type !== 'random' && (
        <input
          type="search"
          className="input"
          aria-label="Tìm chủ đề"
          placeholder="Tìm chủ đề…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <p className="muted small">Chọn một hoặc nhiều chủ đề.</p>
      {failed && <p className="muted small">Không tải được danh sách chủ đề.</p>}
      <ul className="theme-list">
        {themes?.map((t) => {
          const selected = picked.some((p) => sameTheme(p, t));
          return (
            <li key={`${t.type}:${t.key}`}>
              <button
                type="button"
                className={`theme-item${selected ? ' theme-item--selected' : ''}`}
                aria-pressed={selected}
                onClick={() => void pick({ type: t.type, key: t.key })}
              >
                <span>{t.label}</span>
                <span className="muted small">{t.trackCount} bài</span>
              </button>
            </li>
          );
        })}
        {themes?.length === 0 && !failed && <li className="muted small">Không có chủ đề phù hợp.</li>}
      </ul>
    </div>
  );
}
