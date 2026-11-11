'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessageVi } from '@/lib/client/errors-vi';
import { useProfile } from '@/lib/profile/useProfile';
import { MAX_PLAYERS } from '@/lib/rooms/config';
import type { RoomSnapshot } from '@/lib/rooms/snapshot';
import { ProfileSetup } from '../../components/ProfileSetup';
import { Game } from './Game';
import { Lobby } from './Lobby';
import { useRoom } from './useRoom';
import { useRoundAudio } from './useRoundAudio';
import { useServerClock } from './useServerClock';

/** Join errors that clear by themselves; the page re-joins when the room says so. */
const AUTO_RETRY: Record<string, { hint: string; ready: (s: RoomSnapshot) => boolean }> = {
  LATE_JOIN_CLOSED: {
    hint: 'Bạn sẽ tự vào phòng khi ván này kết thúc.',
    ready: (s) => s.phase === 'lobby' || s.phase === 'results',
  },
  ROOM_FULL: {
    hint: 'Bạn sẽ tự vào phòng khi có người rời đi.',
    ready: (s) => s.players.length < MAX_PLAYERS,
  },
};

function Notice({ message, hint, onRetry }: { message: string; hint?: string; onRetry?: () => void }) {
  return (
    <main className="page page--center">
      <div className="card">
        <p className="error" role="alert">
          {message}
        </p>
        {hint && <p className="muted">{hint}</p>}
        <div className="actions actions--center">
          {onRetry && (
            <button type="button" className="btn btn--accent" onClick={onRetry}>
              Thử lại
            </button>
          )}
          <Link className="btn btn--primary" href="/">
            Về trang chủ
          </Link>
        </div>
      </div>
    </main>
  );
}

const Loading = ({ text }: { text: string }) => (
  <main className="page page--center">
    <p className="muted">{text}</p>
  </main>
);

/** /r/[code]: ensures a profile, joins the room, then renders the current phase. */
export function RoomClient({ code }: { code: string }) {
  const router = useRouter();
  const profile = useProfile();
  const room = useRoom(code, { enabled: profile.status === 'ready' });
  const { snapshot, send } = room;
  const [joinError, setJoinError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const joining = useRef(false);
  /** Snapshot a join was last sent for: one attempt per snapshot (a success shows up in the next one). */
  const joinedFor = useRef<RoomSnapshot | null>(null);
  const leaving = useRef(false);

  // Room-scoped (not game-scoped) so the audio unlock and the clock survive "Ván mới".
  const { nowMs } = useServerClock(snapshot?.serverNowMs);
  const audio = useRoundAudio(snapshot?.round?.audioUrl ?? null, snapshot?.round?.nextAudioUrl ?? null, { nowMs });

  // Join whenever we are not a member (first visit, or removed e.g. by another tab's leave),
  // unless we chose to leave or the last refusal still holds.
  useEffect(() => {
    if (!snapshot || snapshot.isMember || leaving.current || joining.current) return;
    if (joinedFor.current === snapshot) return;
    if (joinError && !AUTO_RETRY[joinError]?.ready(snapshot)) return;
    joining.current = true;
    joinedFor.current = snapshot;
    void send({ type: 'join' }).then((res) => {
      joining.current = false;
      setJoinError(res.ok ? null : res.error);
    });
  }, [snapshot, send, joinError, retryNonce]);

  // Coming back from the back/forward cache after a pagehide leave: start fresh.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  if (profile.status === 'loading') return <Loading text="Đang tải…" />;
  if (profile.status === 'error') return <Notice message={profile.error ?? errorMessageVi('INTERNAL')} />;
  if (profile.status === 'needs-profile') {
    return (
      <main className="page page--center">
        <ProfileSetup title="Đặt biệt danh để vào phòng" onSave={profile.save} />
      </main>
    );
  }
  if (room.error) return <Notice message={errorMessageVi(room.error)} />;
  if (joinError && !snapshot?.isMember) {
    const auto = AUTO_RETRY[joinError];
    return (
      <Notice
        message={errorMessageVi(joinError)}
        hint={auto?.hint}
        onRetry={
          auto
            ? undefined
            : () => {
                joinedFor.current = null;
                setJoinError(null);
                setRetryNonce((n) => n + 1);
              }
        }
      />
    );
  }
  if (!snapshot || !snapshot.isMember) return <Loading text="Đang vào phòng…" />;

  const leave = async () => {
    leaving.current = true;
    audio.stop();
    await send({ type: 'leave' });
    router.push('/');
  };

  if (snapshot.phase === 'lobby') return <Lobby snapshot={snapshot} send={send} onLeave={leave} />;

  return <Game snapshot={snapshot} send={send} onLeave={leave} audio={audio} nowMs={nowMs} />;
}
