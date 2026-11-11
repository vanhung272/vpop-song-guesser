'use client';

import { useState } from 'react';
import type { RoomSnapshot } from '@/lib/rooms/snapshot';
import { Ranking, rankOf } from './Scoreboard';
import type { RoomCommand, SendResult } from './useRoom';

export function shareText(snapshot: RoomSnapshot): string {
  const lines = [`Đoán Nhanh V-pop · Chủ đề: ${snapshot.theme?.label ?? '—'}`];
  for (const p of snapshot.players) lines.push(`${rankOf(snapshot.players, p.score)}. ${p.nickname} ${p.score}`);
  const me = snapshot.players.find((p) => p.id === snapshot.viewerId);
  if (me) {
    lines.push(`Mình xếp hạng ${rankOf(snapshot.players, me.score)}/${snapshot.players.length} với ${me.score} điểm!`);
  }
  return lines.join('\n');
}

interface Props {
  snapshot: RoomSnapshot;
  send: (cmd: RoomCommand) => Promise<SendResult>;
  onLeave?: () => void;
}

export function Results({ snapshot, send, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  const winner = snapshot.players[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareText(snapshot));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="page page--game">
      <section className="card results">
        <p className="muted small">Kết thúc · {snapshot.theme?.label}</p>
        <h1 className="results__title">{winner ? `${winner.nickname} thắng!` : 'Kết quả'}</h1>
        <Ranking snapshot={snapshot} label="Xếp hạng chung cuộc" />
        <div className="actions actions--wrap">
          <button type="button" className="btn btn--accent" onClick={copy}>
            Sao chép kết quả
          </button>
          {copied && (
            <span className="muted small" aria-live="polite">
              Đã sao chép!
            </span>
          )}
        </div>
      </section>
      <div className="lobby-footer">
        {onLeave && (
          <button type="button" className="btn btn--ghost" onClick={onLeave}>
            Rời phòng
          </button>
        )}
        {snapshot.isHost ? (
          <button type="button" className="btn btn--primary btn--big" onClick={() => void send({ type: 'rematch' })}>
            Ván mới
          </button>
        ) : (
          <p className="muted">Chờ chủ phòng mở ván mới…</p>
        )}
      </div>
    </main>
  );
}
