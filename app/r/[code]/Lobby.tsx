'use client';

import { useState } from 'react';
import { Avatar } from '@/lib/avatar/Avatar';
import { errorMessageVi } from '@/lib/client/errors-vi';
import { MAX_PLAYERS, QUESTION_COUNT_OPTIONS, TIME_LIMIT_OPTIONS_MS } from '@/lib/rooms/config';
import type { RoomSnapshot } from '@/lib/rooms/snapshot';
import type { RoomSettings } from '@/lib/rooms/state-machine';
import { InvitePanel } from './InvitePanel';
import { ThemePicker } from './ThemePicker';
import type { RoomCommand, SendResult } from './useRoom';

interface Props {
  snapshot: RoomSnapshot;
  send: (cmd: RoomCommand) => Promise<SendResult>;
  onLeave?: () => void;
}

const seconds = (ms: number) => `${ms / 1000} giây`;

export function Lobby({ snapshot, send, onLeave }: Props) {
  const [error, setError] = useState<string | null>(null);
  /** Start checks every preview server-side and can take seconds: block repeat clicks meanwhile. */
  const [starting, setStarting] = useState(false);
  const { settings, isHost, players } = snapshot;

  async function run(cmd: RoomCommand) {
    setError(null);
    const res = await send(cmd);
    if (!res.ok) setError(errorMessageVi(res.error));
  }
  async function start() {
    setStarting(true);
    try {
      await run({ type: 'start' });
    } finally {
      setStarting(false);
    }
  }
  const patch = (p: Partial<RoomSettings>) => void run({ type: 'settings', patch: p });

  return (
    <main className="page page--lobby">
      <InvitePanel code={snapshot.code} />

      <section className="card">
        <div className="section-head">
          <h2>Người chơi</h2>
          <span className="pill">
            {players.length}/{MAX_PLAYERS}
          </span>
        </div>
        <ul className="players">
          {players.map((p) => (
            <li key={p.id} className={`player${p.online ? '' : ' player--offline'}`}>
              <Avatar seed={p.avatarSeed} size={40} label={`Avatar của ${p.nickname}`} />
              <span className="player__name">{p.nickname}</span>
              {p.isHost && <span className="badge">Chủ phòng</span>}
              {p.id === snapshot.viewerId && <span className="badge badge--me">Bạn</span>}
              {!p.online && <span className="muted small">mất kết nối</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Cài đặt</h2>
        {isHost ? (
          <div className="settings">
            <label className="field">
              <span className="field__label">Số câu</span>
              <select
                className="input"
                value={settings.questionCount}
                onChange={(e) => patch({ questionCount: Number(e.target.value) })}
              >
                {QUESTION_COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} câu
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Thời gian mỗi câu</span>
              <select
                className="input"
                value={settings.timeLimitMs}
                onChange={(e) => patch({ timeLimitMs: Number(e.target.value) })}
              >
                {TIME_LIMIT_OPTIONS_MS.map((ms) => (
                  <option key={ms} value={ms}>
                    {seconds(ms)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <dl className="settings-view">
            <dt>Số câu</dt>
            <dd>{settings.questionCount} câu</dd>
            <dt>Thời gian mỗi câu</dt>
            <dd>{seconds(settings.timeLimitMs)}</dd>
          </dl>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Chủ đề</h2>
          <span className="pill pill--accent">{snapshot.theme?.label ?? 'Chưa chọn'}</span>
        </div>
        {isHost && (
          <ThemePicker current={snapshot.theme} onPick={(theme) => void run({ type: 'theme', theme })} />
        )}
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="lobby-footer">
        {onLeave && (
          <button type="button" className="btn btn--ghost" onClick={onLeave}>
            Rời phòng
          </button>
        )}
        {isHost ? (
          <button
            type="button"
            className="btn btn--primary btn--big"
            disabled={!snapshot.theme || starting}
            aria-busy={starting}
            onClick={() => void start()}
          >
            {starting ? 'Đang bắt đầu…' : 'Bắt đầu'}
          </button>
        ) : (
          <p className="muted">Chờ chủ phòng bắt đầu…</p>
        )}
      </div>
    </main>
  );
}
