import { describe, expect, it, vi } from 'vitest';
import { ensureAnonymousSession, resetAnonymousSession } from './client';

function fakeAuth(session: { user: { id: string } } | null, signInResult?: unknown) {
  return {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    signInAnonymously: vi.fn(async () => signInResult),
  };
}

describe('ensureAnonymousSession', () => {
  it('reuses an existing session without signing in again', async () => {
    const auth = fakeAuth({ user: { id: 'u-1' } });
    expect(await ensureAnonymousSession({ auth } as never)).toBe('u-1');
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('signs in anonymously on first visit', async () => {
    const auth = fakeAuth(null, { data: { user: { id: 'u-2' } }, error: null });
    expect(await ensureAnonymousSession({ auth } as never)).toBe('u-2');
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('throws when anonymous sign-in fails', async () => {
    const auth = fakeAuth(null, { data: { user: null }, error: { message: 'disabled' } });
    await expect(ensureAnonymousSession({ auth } as never)).rejects.toThrow('disabled');
  });
});

describe('resetAnonymousSession', () => {
  it('drops the local session and signs in anonymously again', async () => {
    const calls: string[] = [];
    const auth = {
      signOut: vi.fn(async (opts: unknown) => {
        calls.push(`signOut:${JSON.stringify(opts)}`);
        return { error: null };
      }),
      signInAnonymously: vi.fn(async () => {
        calls.push('signIn');
        return { data: { user: { id: 'u-3' } }, error: null };
      }),
    };
    expect(await resetAnonymousSession({ auth } as never)).toBe('u-3');
    expect(calls).toEqual(['signOut:{"scope":"local"}', 'signIn']);
  });
});
