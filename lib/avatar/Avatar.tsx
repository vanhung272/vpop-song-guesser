'use client';

import { useEffect, useMemo, useRef } from 'react';
import { avatarFromSeed } from './avatar-spec';
import { drawAvatar } from './draw';

export interface AvatarProps {
  seed: string;
  size?: number;
  /** Accessible name; defaults to a generic Vietnamese label. */
  label?: string;
  className?: string;
}

/** Seeded avatar drawn on a <canvas>, crisp on high-DPI screens. */
export function Avatar({ seed, size = 48, label = 'Ảnh đại diện', className }: AvatarProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(() => avatarFromSeed(seed), [seed]);
  const dpr = typeof window === 'undefined' ? 1 : Math.max(1, Math.round(window.devicePixelRatio || 1));

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAvatar(ctx, spec, size);
  }, [spec, size, dpr]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={className}
      width={size * dpr}
      height={size * dpr}
      style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%' }}
    />
  );
}
