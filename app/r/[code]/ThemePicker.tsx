'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import type { ThemeRef } from '@/lib/rooms/round-builder';
import type { ThemeSummary, ThemeType } from '@/lib/themes/themes';

const TYPE_LABELS: Record<ThemeType, string> = {
  artist: 'Ca sĩ',
  genre: 'Thể loại',
  decade: 'Thời gian ra mắt',
  random: 'Ngẫu nhiên',
};

interface Props {
  current: ThemeRef | null;
  onPick: (theme: ThemeRef) => void;
}

/** Host-only theme browser: type tabs + search over GET /api/themes. */
export function ThemePicker({ current, onPick }: Props) {
  const [type, setType] = useState<ThemeType>(current?.type ?? 'artist');
  const [q, setQ] = useState('');
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ type });
      if (q.trim()) params.set('q', q.trim());
      const res = await apiFetch<ThemeSummary[]>(`/api/themes?${params}`);
      if (cancelled) return;
      setFailed(!res.ok);
      // Only themes with enough songs for any question count; the rest cannot be picked anyway.
      setThemes(res.ok && Array.isArray(res.data) ? res.data.filter((t) => t.playable) : []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [type, q]);

  return (
    <div className="theme-picker">
      <div className="tabs" role="tablist">
        {(Object.keys(TYPE_LABELS) as ThemeType[]).map((t) => (
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
      <input
        type="search"
        className="input"
        aria-label="Tìm chủ đề"
        placeholder="Tìm chủ đề…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {failed && <p className="muted small">Không tải được danh sách chủ đề.</p>}
      <ul className="theme-list">
        {themes?.map((t) => {
          const selected = current?.type === t.type && current.key === t.key;
          return (
            <li key={`${t.type}:${t.key}`}>
              <button
                type="button"
                className={`theme-item${selected ? ' theme-item--selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onPick({ type: t.type, key: t.key })}
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
