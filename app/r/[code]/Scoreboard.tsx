'use client';

import { useState } from 'react';
import { Avatar } from '@/lib/avatar/Avatar';
import type { RoomSnapshot } from '@/lib/rooms/snapshot';

/** Competition ranking: equal scores share a rank (1, 2, 2, 4). Players arrive score-desc. */
export function rankOf(players: RoomSnapshot['players'], score: number): number {
  return 1 + players.filter((p) => p.score > score).length;
}

export function Ranking({ snapshot, label }: { snapshot: RoomSnapshot; label: string }) {
  return (
    <ol className="ranking" aria-label={label}>
      {snapshot.players.map((p) => (
        <li key={p.id} className={`ranking__row${p.id === snapshot.viewerId ? ' ranking__row--me' : ''}`}>
          <span className="ranking__rank">{rankOf(snapshot.players, p.score)}</span>
          <Avatar seed={p.avatarSeed} size={32} label={`Avatar của ${p.nickname}`} />
          <span className="ranking__name">
            {p.nickname}
            {p.hasAnswered && <span className="sr-only"> (đã trả lời)</span>}
          </span>
          {p.hasAnswered && <span className="ranking__answered" aria-hidden="true">✓</span>}
          <span className="ranking__score">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

function History({ snapshot }: { snapshot: RoomSnapshot }) {
  if (snapshot.history.length === 0) return <p className="muted small">Chưa có vòng nào kết thúc.</p>;
  return (
    <ol className="history">
      {[...snapshot.history].reverse().map((h) => (
        <li key={h.idx} className="history__row">
          <span className="history__round">#{h.roundNumber}</span>
          <span className="history__track">
            <strong>{h.track.title}</strong>
            <span className="muted small">{h.track.artist}</span>
          </span>
          <span className={h.correct ? 'history__pts history__pts--ok' : 'history__pts'}>
            {h.correct ? `+${h.myPoints}` : h.myAnswerId ? 'Sai' : '—'}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** In-game side panel: live ranking / round history tabs. */
export function Scoreboard({ snapshot }: { snapshot: RoomSnapshot }) {
  const [tab, setTab] = useState<'ranking' | 'history'>('ranking');
  return (
    <section className="card scoreboard">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ranking'}
          className={`tab${tab === 'ranking' ? ' tab--active' : ''}`}
          onClick={() => setTab('ranking')}
        >
          Bảng xếp hạng
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={`tab${tab === 'history' ? ' tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          Lịch sử
        </button>
      </div>
      <div role="tabpanel">
        {tab === 'ranking' ? <Ranking snapshot={snapshot} label="Bảng xếp hạng" /> : <History snapshot={snapshot} />}
      </div>
    </section>
  );
}
