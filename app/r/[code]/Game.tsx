'use client';

import { useEffect, useState } from 'react';
import { errorMessageVi } from '@/lib/client/errors-vi';
import type { RoomSnapshot, SnapshotRound } from '@/lib/rooms/snapshot';
import { Results } from './Results';
import { Scoreboard } from './Scoreboard';
import { useAutoTick } from './useAutoTick';
import type { RoomCommand, SendResult } from './useRoom';
import type { RoundAudio } from './useRoundAudio';

interface Props {
  snapshot: RoomSnapshot;
  send: (cmd: RoomCommand) => Promise<SendResult>;
  onLeave?: () => void;
  /** Room-scoped audio (owned by RoomClient so the unlock survives rematches). */
  audio: RoundAudio;
  /** Server time, see useServerClock. */
  nowMs: () => number;
}

const QUESTION_LABEL = { title: 'Bài gì?', artist: 'Ca sĩ nào?' } as const;

/** Re-renders every `intervalMs` so time-based UI (timer, countdown) stays current. */
function useTicker(intervalMs = 200): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

const secondsLeft = (endsAt: number | null, now: number) =>
  endsAt == null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));

/** Countdown, round card, question, reveal and results screens. */
export function Game({ snapshot, send, onLeave, audio, nowMs }: Props) {
  useTicker();
  const now = nowMs();
  const { phase, round, phaseEndsAt } = snapshot;
  useAutoTick(snapshot, nowMs, send);

  // The clip starts with the question (server time) and keeps playing through the reveal.
  const questionStart = phase === 'question' && phaseEndsAt != null ? phaseEndsAt - snapshot.settings.timeLimitMs : null;
  const { unlocked, ready, playAt, stop } = audio;
  useEffect(() => {
    if (questionStart != null && unlocked) playAt(questionStart);
  }, [questionStart, round?.idx, unlocked, ready, playAt]);
  useEffect(() => {
    if (phase === 'results' || phase === 'countdown') stop();
  }, [phase, stop]);

  if (phase === 'results') return <Results snapshot={snapshot} send={send} onLeave={onLeave} />;

  return (
    <main className="page page--game">
      <header className="game-head">
        <span className="pill pill--accent">{snapshot.theme?.label}</span>
        {!audio.unlocked && (
          <button type="button" className="btn btn--accent btn--small" onClick={() => void audio.unlock()}>
            Bật âm thanh
          </button>
        )}
      </header>

      {phase === 'countdown' && (
        <section className="card stage stage--countdown">
          <p className="muted">Sẵn sàng…</p>
          <p className="countdown" aria-label="Đếm ngược">
            {secondsLeft(phaseEndsAt, now)}
          </p>
        </section>
      )}

      {phase === 'presenting' && round && <RoundCard snapshot={snapshot} round={round} />}

      {(phase === 'question' || phase === 'reveal') && round && (
        <QuestionView key={round.idx} snapshot={snapshot} round={round} now={now} audio={audio} send={send} />
      )}

      <Scoreboard snapshot={snapshot} />
    </main>
  );
}

function RoundCard({ snapshot, round }: { snapshot: RoomSnapshot; round: SnapshotRound }) {
  const title = `Vòng ${round.roundNumber}/${snapshot.questionCount}`;
  const { base, maxBonus } = round.pointsOnOffer;
  return (
    <section className="card stage stage--round" aria-label={title}>
      <p className="round-card__title">{title}</p>
      <p className="round-card__question">{QUESTION_LABEL[round.questionType]}</p>
      <p className="round-card__max">Tối đa {base + maxBonus} điểm</p>
      <p className="muted small">
        {base} điểm khi đúng · +{maxBonus} thưởng tốc độ
      </p>
      {!round.canAnswer && <SpectatorNote />}
    </section>
  );
}

const SpectatorNote = () => <p className="note">Bạn vào giữa vòng này, hãy trả lời từ vòng sau nhé.</p>;

interface QuestionProps {
  snapshot: RoomSnapshot;
  round: SnapshotRound;
  now: number;
  audio: RoundAudio;
  send: (cmd: RoomCommand) => Promise<SendResult>;
}

function QuestionView({ snapshot, round, now, audio, send }: QuestionProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isReveal = snapshot.phase === 'reveal';
  const myAnswerId = round.myAnswer?.answerId ?? picked;
  const locked = isReveal || !round.canAnswer || myAnswerId != null;
  const left = secondsLeft(snapshot.phaseEndsAt, now);
  const limit = snapshot.settings.timeLimitMs;
  const fraction = snapshot.phaseEndsAt == null ? 0 : Math.max(0, Math.min(1, (snapshot.phaseEndsAt - now) / limit));
  const reveal = round.reveal;

  async function choose(answerId: string) {
    if (locked) return;
    setPicked(answerId);
    setError(null);
    if (!audio.unlocked) void audio.unlock();
    const res = await send({ type: 'answer', answerId });
    if (!res.ok && res.error !== 'ALREADY_ANSWERED') {
      setPicked(null);
      setError(errorMessageVi(res.error));
    }
  }

  return (
    <>
      <section className="card stage stage--question">
        <div className="question-head">
          <span className="muted small">
            Vòng {round.roundNumber}/{snapshot.questionCount}
          </span>
          <strong>{QUESTION_LABEL[round.questionType]}</strong>
          {!isReveal && (
            <span className="timer" aria-label="Thời gian còn lại">
              {left}
            </span>
          )}
        </div>
        {!isReveal && (
          <div className="timebar" aria-hidden="true">
            <div className="timebar__fill" style={{ transform: `scaleX(${fraction})` }} />
          </div>
        )}
        {!isReveal && audio.failed && <p className="note">Không tải được đoạn nhạc này. Bạn vẫn có thể đoán!</p>}
        {!isReveal && !round.canAnswer && <SpectatorNote />}

        <div className="choices">
          {(round.choices ?? []).map((c) => {
            const mine = c.answerId === myAnswerId;
            const correct = reveal?.correctAnswerId === c.answerId;
            const pct = round.livePercentages?.[c.answerId];
            const cls = [
              'choice',
              mine && 'choice--mine',
              reveal && correct && 'choice--correct',
              reveal && mine && !correct && 'choice--wrong',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button key={c.answerId} type="button" className={cls} disabled={locked} onClick={() => void choose(c.answerId)}>
                {pct != null && <span className="choice__pct" style={{ width: `${pct}%` }} aria-hidden="true" />}
                <span className="choice__label">{c.label}</span>
                <span className="choice__meta">
                  {mine && <span className="choice__tag">Bạn đã chọn</span>}
                  {pct != null && <span className="choice__num">{pct}%</span>}
                </span>
              </button>
            );
          })}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {isReveal && reveal && (
        <section className="card reveal" aria-label="Đáp án">
          <div className="reveal__track">
            {reveal.track.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- iTunes artwork, arbitrary remote host
              <img
                className="reveal__cover"
                src={reveal.track.coverUrl}
                alt={`Bìa bài ${reveal.track.title}`}
                width={96}
                height={96}
              />
            ) : (
              <div className="reveal__cover reveal__cover--empty" aria-hidden="true">
                ♪
              </div>
            )}
            <div>
              <p className="reveal__title">{reveal.track.title}</p>
              <p className="muted">{reveal.track.artist}</p>
            </div>
          </div>
          {round.canAnswer && (
            <p className={round.myAnswer?.correct ? 'reveal__points reveal__points--ok' : 'reveal__points'}>
              {round.myAnswer?.correct ? `Chính xác! +${round.myAnswer.points ?? 0} điểm` : round.myAnswer ? 'Sai rồi · 0 điểm' : 'Bạn chưa chọn · 0 điểm'}
            </p>
          )}
          <h3 className="small">Nhanh nhất vòng này</h3>
          <ol className="top3" aria-label="Top 3 vòng này">
            {reveal.top3.map((t, i) => (
              <li key={t.playerId}>
                <span className="top3__medal">{['🥇', '🥈', '🥉'][i]}</span>
                <span className="top3__name">{t.nickname}</span>
                <span className="top3__pts">+{t.points}</span>
              </li>
            ))}
            {reveal.top3.length === 0 && <li className="muted small">Chưa ai đoán đúng.</li>}
          </ol>
        </section>
      )}
    </>
  );
}
