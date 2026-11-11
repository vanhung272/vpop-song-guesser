'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { errorMessageVi } from '@/lib/client/errors-vi';
import { ensureAnonymousSession, resetAnonymousSession } from '@/lib/supabase/client';

export interface Profile {
  id: string;
  nickname: string;
  avatarSeed: string;
}

export interface ProfileState {
  status: 'loading' | 'needs-profile' | 'ready' | 'error';
  profile: Profile | null;
  error: string | null;
  /** Creates/updates the profile; resolves to a Vietnamese error message, or null on success. */
  save: (nickname: string, avatarSeed: string) => Promise<string | null>;
}

const CONNECT_ERROR = 'Không kết nối được máy chủ. Hãy tải lại trang.';

/** Anonymous session + guest profile. Signs in anonymously on the first visit. */
export function useProfile(): ProfileState {
  const [status, setStatus] = useState<ProfileState['status']>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fail = () => {
        if (!cancelled) {
          setError(CONNECT_ERROR);
          setStatus('error');
        }
      };
      try {
        await ensureAnonymousSession();
      } catch {
        return fail();
      }
      let res = await apiFetch<Profile>('/api/profile');
      if (cancelled) return;
      // A stored session the server rejects would otherwise block the user until it expires.
      if (!res.ok && res.status === 401) {
        try {
          await resetAnonymousSession();
        } catch {
          return fail();
        }
        res = await apiFetch<Profile>('/api/profile');
        if (cancelled) return;
      }
      if (res.ok) {
        setProfile(res.data);
        setStatus('ready');
      } else if (res.status === 404) {
        setStatus('needs-profile');
      } else {
        setError(CONNECT_ERROR);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (nickname: string, avatarSeed: string) => {
    const res = await apiFetch<Profile>('/api/profile', { method: 'POST', body: { nickname, avatarSeed } });
    if (!res.ok) return errorMessageVi(res.error);
    setProfile(res.data);
    setStatus('ready');
    setError(null);
    return null;
  }, []);

  return { status, profile, error, save };
}
