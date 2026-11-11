'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/lib/avatar/Avatar';
import { apiFetch } from '@/lib/client/api';
import { errorMessageVi } from '@/lib/client/errors-vi';
import { useProfile } from '@/lib/profile/useProfile';
import { ROOM_CODE_LENGTH } from '@/lib/rooms/config';
import { ProfileSetup } from './components/ProfileSetup';

const CODE_RE = new RegExp(`^[0-9]{${ROOM_CODE_LENGTH}}$`);

export function HomeClient() {
  const router = useRouter();
  const profile = useProfile();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function join(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim();
    if (!CODE_RE.test(clean)) {
      setError(`Mã phòng gồm đúng ${ROOM_CODE_LENGTH} chữ số.`);
      return;
    }
    setError(null);
    router.push(`/r/${clean}`);
  }

  async function create() {
    setCreating(true);
    setError(null);
    const res = await apiFetch<{ code: string }>('/api/rooms', { method: 'POST' });
    if (res.ok) {
      router.push(`/r/${res.data.code}`);
    } else {
      setCreating(false);
      setError(errorMessageVi(res.error));
    }
  }

  let body;
  if (profile.status === 'loading') {
    body = <p className="muted">Đang tải…</p>;
  } else if (profile.status === 'error') {
    body = (
      <p className="error" role="alert">
        {profile.error}
      </p>
    );
  } else if (profile.status === 'needs-profile' || editing || !profile.profile) {
    body = (
      <ProfileSetup
        initial={profile.profile}
        onCancel={editing ? () => setEditing(false) : undefined}
        onSave={async (nickname, seed) => {
          const err = await profile.save(nickname, seed);
          if (!err) setEditing(false);
          return err;
        }}
      />
    );
  } else {
    body = (
      <>
        <div className="card me">
          <Avatar seed={profile.profile.avatarSeed} size={56} />
          <div className="me__name">
            <span className="muted small">Chơi với tên</span>
            <strong>{profile.profile.nickname}</strong>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => setEditing(true)}>
            Sửa
          </button>
        </div>

        <div className="card home-actions">
          <button type="button" className="btn btn--primary btn--big" onClick={create} disabled={creating}>
            Tạo phòng
          </button>
          <div className="divider">
            <span>hoặc</span>
          </div>
          <form className="join-form" onSubmit={join} noValidate>
            <label className="field">
              <span className="field__label">Mã phòng</span>
              <input
                className="input input--code"
                value={code}
                inputMode="numeric"
                autoComplete="off"
                maxLength={ROOM_CODE_LENGTH + 2}
                placeholder="•••••"
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn--accent">
              Vào phòng
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <main className="page page--home">
      <header className="hero">
        <h1 className="logo">
          Đoán Nhanh <span>V-pop</span>
        </h1>
        <p className="muted">Nghe vài giây nhạc, đoán bài nhanh hơn bạn bè.</p>
      </header>
      {body}
    </main>
  );
}
