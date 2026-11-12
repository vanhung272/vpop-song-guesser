'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RoundAudio {
  /**
   * Sound is on unless the browser refused to play (autoplay policy before any click on the page).
   * While false, a "Bật âm thanh" click (or any click/keypress on the page) calls `unlock`.
   */
  unlocked: boolean;
  /** The current clip can play through. */
  ready: boolean;
  /** The current clip is missing or failed to load. */
  failed: boolean;
  /** Call from a click handler: unlocks the playback element inside the gesture. */
  unlock: () => Promise<void>;
  /** Plays the current clip as if it started at `startMs` (server time); seeks in when late. */
  playAt: (startMs: number) => void;
  stop: () => void;
  /**
   * Lowers the volume to silence over `ms`, then pauses (the reveal). Browsers that do not let a
   * page set the volume (iOS Safari) keep playing at full volume and pause after `ms`.
   */
  fadeOut: (ms: number) => void;
}

const FADE_STEP_MS = 50;

interface Options {
  /** Server time (see useServerClock). */
  nowMs: () => number;
  createAudio?: () => HTMLAudioElement;
}

const defaultCreateAudio = () => new Audio();

/** Events that count as a user gesture for the browser's autoplay policy. */
const GESTURE_EVENTS = ['click', 'keydown', 'touchend'] as const;

/**
 * One long-lived playback element (iOS only lets the element that was unlocked by a gesture play
 * later) plus a preloader element that warms the HTTP cache for the next round's clip.
 * Sound is on by default: clips play when the browser allows it, and the first gesture anywhere on
 * the page (joining, "Bắt đầu", an answer…) unlocks the element for browsers that need one.
 */
export function useRoundAudio(
  currentUrl: string | null,
  nextUrl: string | null,
  { nowMs, createAudio = defaultCreateAudio }: Options,
): RoundAudio {
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const preloaderRef = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** A gesture already unlocked the playback element. */
  const gestured = useRef(false);
  const blockedRef = useRef(false);
  const createRef = useRef(createAudio);
  const [blocked, setBlocked] = useState(false);
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
  /** Cancels a running fade and puts the volume back to full for whatever plays next. */
  const clearFade = useCallback(() => {
    if (fadeTimer.current) clearInterval(fadeTimer.current);
    fadeTimer.current = null;
    if (playerRef.current) playerRef.current.volume = 1;
  }, []);

  // Current clip: swap the playback element's source.
  useEffect(() => {
    const player = getPlayer();
    clearTimer();
    clearFade();
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
  }, [currentUrl, getPlayer, clearTimer, clearFade]);

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
      clearFade();
      playerRef.current?.pause();
      playerRef.current?.removeAttribute('src');
      preloaderRef.current?.removeAttribute('src');
    },
    [clearTimer, clearFade],
  );

  const unlock = useCallback(async () => {
    gestured.current = true;
    blockedRef.current = false;
    const player = getPlayer();
    // A clip already playing is unlocked; a play/pause here would cut it off.
    if (player.paused) {
      try {
        await player.play();
        player.pause();
      } catch {
        // Some browsers reject play() on an element without a loaded source; the gesture still counts.
      }
    }
    setBlocked(false);
  }, [getPlayer]);

  // The first gesture anywhere on the page unlocks audio, and so does the next one after a block.
  useEffect(() => {
    const onGesture = () => {
      if (!gestured.current || blockedRef.current) void unlock();
    };
    for (const e of GESTURE_EVENTS) window.addEventListener(e, onGesture, true);
    return () => {
      for (const e of GESTURE_EVENTS) window.removeEventListener(e, onGesture, true);
    };
  }, [unlock]);

  const playAt = useCallback(
    (startMs: number) => {
      clearTimer();
      clearFade();
      const player = getPlayer();
      const start = () => {
        player.currentTime = Math.max(0, nowMs() - startMs) / 1000;
        void Promise.resolve(player.play()).catch((e: unknown) => {
          // Only the autoplay policy locks sound; e.g. an AbortError from a source swap does not.
          if ((e as { name?: string } | null)?.name !== 'NotAllowedError') return;
          blockedRef.current = true;
          setBlocked(true);
        });
      };
      const wait = startMs - nowMs();
      if (wait > 0) timer.current = setTimeout(start, wait);
      else start();
    },
    [nowMs, getPlayer, clearTimer, clearFade],
  );

  const stop = useCallback(() => {
    clearTimer();
    clearFade();
    playerRef.current?.pause();
  }, [clearTimer, clearFade]);

  const fadeOut = useCallback(
    (ms: number) => {
      clearTimer(); // a clip that has not started yet will not start
      clearFade();
      const player = playerRef.current;
      if (!player || player.paused) return;
      const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
      let step = 0;
      fadeTimer.current = setInterval(() => {
        step++;
        if (step < steps) {
          player.volume = Math.max(0, 1 - step / steps);
          return;
        }
        player.pause();
        clearFade();
      }, FADE_STEP_MS);
    },
    [clearTimer, clearFade],
  );

  const current = loaded.url === currentUrl;
  return {
    unlocked: !blocked,
    ready: current && loaded.ready,
    failed: !currentUrl || (current && loaded.failed),
    unlock,
    playAt,
    stop,
    fadeOut,
  };
}
