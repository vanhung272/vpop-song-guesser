'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RoundAudio {
  /** The user clicked once, so the browser lets this page play audio. */
  unlocked: boolean;
  /** The current clip can play through. */
  ready: boolean;
  /** The current clip is missing or failed to load. */
  failed: boolean;
  /** Call from a click handler: plays/pauses the playback element inside the gesture. */
  unlock: () => Promise<void>;
  /** Plays the current clip as if it started at `startMs` (server time); seeks in when late. */
  playAt: (startMs: number) => void;
  stop: () => void;
}

interface Options {
  /** Server time (see useServerClock). */
  nowMs: () => number;
  createAudio?: () => HTMLAudioElement;
}

const defaultCreateAudio = () => new Audio();

/**
 * One long-lived playback element (iOS only lets the element that was unlocked by a gesture play
 * later) plus a preloader element that warms the HTTP cache for the next round's clip.
 */
export function useRoundAudio(
  currentUrl: string | null,
  nextUrl: string | null,
  { nowMs, createAudio = defaultCreateAudio }: Options,
): RoundAudio {
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const preloaderRef = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockedRef = useRef(false);
  const createRef = useRef(createAudio);
  const [unlocked, setUnlocked] = useState(false);
  const [loaded, setLoaded] = useState<{ url: string | null; ready: boolean; failed: boolean }>({
    url: null,
    ready: false,
    failed: false,
  });

  const getPlayer = useCallback(() => (playerRef.current ??= createRef.current()), []);
  const getPreloader = useCallback(() => (preloaderRef.current ??= createRef.current()), []);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Current clip: swap the playback element's source.
  useEffect(() => {
    const player = getPlayer();
    clearTimer();
    player.pause();
    if (!currentUrl) return;
    const onReady = () => setLoaded({ url: currentUrl, ready: true, failed: false });
    const onError = () => setLoaded({ url: currentUrl, ready: false, failed: true });
    player.addEventListener('canplaythrough', onReady);
    player.addEventListener('error', onError);
    player.preload = 'auto';
    player.src = currentUrl;
    player.load();
    return () => {
      player.removeEventListener('canplaythrough', onReady);
      player.removeEventListener('error', onError);
    };
  }, [currentUrl, getPlayer, clearTimer]);

  // Next clip: preload only, never played.
  useEffect(() => {
    if (!nextUrl) return;
    const preloader = getPreloader();
    preloader.preload = 'auto';
    preloader.src = nextUrl;
    preloader.load();
  }, [nextUrl, getPreloader]);

  useEffect(
    () => () => {
      clearTimer();
      playerRef.current?.pause();
      playerRef.current?.removeAttribute('src');
      preloaderRef.current?.removeAttribute('src');
    },
    [clearTimer],
  );

  const unlock = useCallback(async () => {
    const player = getPlayer();
    try {
      await player.play();
      player.pause();
    } catch {
      // Some browsers reject play() on an element without a loaded source; the gesture still counts.
    }
    unlockedRef.current = true;
    setUnlocked(true);
  }, [getPlayer]);

  const playAt = useCallback(
    (startMs: number) => {
      if (!unlockedRef.current) return;
      clearTimer();
      const player = getPlayer();
      const start = () => {
        player.currentTime = Math.max(0, nowMs() - startMs) / 1000;
        void Promise.resolve(player.play()).catch(() => {});
      };
      const wait = startMs - nowMs();
      if (wait > 0) timer.current = setTimeout(start, wait);
      else start();
    },
    [nowMs, getPlayer, clearTimer],
  );

  const stop = useCallback(() => {
    clearTimer();
    playerRef.current?.pause();
  }, [clearTimer]);

  const current = loaded.url === currentUrl;
  return {
    unlocked,
    ready: current && loaded.ready,
    failed: !currentUrl || (current && loaded.failed),
    unlock,
    playAt,
    stop,
  };
}
