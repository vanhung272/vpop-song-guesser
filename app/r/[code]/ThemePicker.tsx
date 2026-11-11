'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
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
  onPick: (theme: ThemeRef) => void;
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

/** Host-only theme browser: type tabs over GET /api/themes; one or several themes can be picked. */
export function ThemePicker({ current, onPick }: Props) {
  const picked = themeParts(current);
  const [type, setType] = useState<PickableThemeType>(
    (picked[0]?.type as PickableThemeType | undefined) ?? 'artist',
  );
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ type });
      const res = await apiFetch<ThemeSummary[]>(`/api/themes?${params}`);
      if (cancelled) return;
      setFailed(!res.ok);
      // Only themes with enough songs for any question count; the rest cannot be picked anyway.
      setThemes(res.ok && Array.isArray(res.data) ? res.data.filter((t) => t.playable) : []);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [type]);

  function pick(item: ThemeRef) {
    const next = togglePick(picked, item);
    const theme = next && mixTheme(next);
    if (theme) onPick(theme);
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
            onClick={() => setType(t)}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
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
                onClick={() => pick({ type: t.type, key: t.key })}
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
