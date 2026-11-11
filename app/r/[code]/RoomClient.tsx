'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessageVi } from '@/lib/client/errors-vi';
import { useProfile } from '@/lib/profile/useProfile';
import { ProfileSetup } from '../../components/ProfileSetup';
import { Game } from './Game';
import { Lobby } from './Lobby';
import { useRoom } from './useRoom';

function Notice({ message }: { message: string }) {
  return (
    <main className="page page--center">
      <div className="card">
        <p className="error" role="alert">
          {message}
        </p>
        <Link className="btn btn--primary" href="/">
          Về trang chủ
        </Link>
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
  const joinTried = useRef(false);

  useEffect(() => {
    if (!snapshot || snapshot.isMember || joinTried.current) return;
    joinTried.current = true;
    void send({ type: 'join' }).then((res) => {
      if (!res.ok) setJoinError(res.error);
    });
  }, [snapshot, send]);

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
  if (joinError) return <Notice message={errorMessageVi(joinError)} />;
  if (!snapshot) return <Loading text="Đang vào phòng…" />;
  if (!snapshot.isMember) return <Loading text="Đang vào phòng…" />;

  const leave = async () => {
    await send({ type: 'leave' });
    router.push('/');
  };

  if (snapshot.phase === 'lobby') return <Lobby snapshot={snapshot} send={send} onLeave={leave} />;

  return <Game snapshot={snapshot} send={send} onLeave={leave} />;
}
