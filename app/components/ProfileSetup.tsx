'use client';

import { useState, type FormEvent } from 'react';
import { Avatar } from '@/lib/avatar/Avatar';
import { randomSeed } from '@/lib/avatar/avatar-spec';
import { NICKNAME_MAX, cleanNickname, randomNickname } from '@/lib/profile/nickname';
import type { Profile } from '@/lib/profile/useProfile';

interface Props {
  title?: string;
  initial?: Profile | null;
  onSave: (nickname: string, avatarSeed: string) => Promise<string | null>;
  onCancel?: () => void;
}

/** Nickname + seeded avatar form. Used on first visit and when editing the profile. */
export function ProfileSetup({ title = 'Bạn là ai?', initial, onSave, onCancel }: Props) {
  const [nickname, setNickname] = useState(initial?.nickname ?? '');
  const [seed, setSeed] = useState(() => initial?.avatarSeed ?? randomSeed());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = cleanNickname(nickname);
    if (!clean) {
      setError('Biệt danh cần từ 1 đến 30 ký tự.');
      return;
    }
    setError(null);
    setSaving(true);
    const err = await onSave(clean, seed);
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <form className="card profile-setup" onSubmit={submit}>
      <h2>{title}</h2>
      <div className="profile-setup__avatar">
        <Avatar seed={seed} size={96} />
        <button type="button" className="btn btn--ghost" onClick={() => setSeed(randomSeed())}>
          Đổi avatar
        </button>
      </div>
      <label className="field">
        <span className="field__label">Biệt danh</span>
        <div className="field__row">
          <input
            className="input"
            value={nickname}
            maxLength={NICKNAME_MAX + 10}
            placeholder="Ví dụ: Cáo Thính Tai"
            autoComplete="nickname"
            onChange={(e) => setNickname(e.target.value)}
          />
          <button type="button" className="btn btn--ghost" onClick={() => setNickname(randomNickname())}>
            Tên ngẫu nhiên
          </button>
        </div>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Hủy
          </button>
        )}
        <button type="submit" className="btn btn--primary" disabled={saving}>
          Lưu
        </button>
      </div>
    </form>
  );
}
