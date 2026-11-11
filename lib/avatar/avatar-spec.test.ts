import { describe, expect, it } from 'vitest';
import {
  ACCESSORIES,
  BACKGROUNDS,
  EYES,
  FACE_SHAPES,
  MOUTHS,
  SKIN_TONES,
  avatarFromSeed,
  randomSeed,
} from './avatar-spec';

describe('avatarFromSeed', () => {
  it('same seed returns identical spec', () => {
    expect(avatarFromSeed('seed-abc')).toEqual(avatarFromSeed('seed-abc'));
  });

  it('different seeds produce different specs for at least 95 of 100 random seeds', () => {
    const specs = new Set<string>();
    for (let i = 0; i < 100; i++) specs.add(JSON.stringify(avatarFromSeed(randomSeed())));
    expect(specs.size).toBeGreaterThanOrEqual(95);
  });

  it('spec values stay within the defined palettes and part counts', () => {
    for (let i = 0; i < 200; i++) {
      const spec = avatarFromSeed(i === 0 ? '' : randomSeed());
      expect(BACKGROUNDS).toContain(spec.background);
      expect(SKIN_TONES).toContain(spec.skin);
      expect(FACE_SHAPES).toContain(spec.faceShape);
      expect(EYES).toContain(spec.eyes);
      expect(MOUTHS).toContain(spec.mouth);
      expect(ACCESSORIES).toContain(spec.accessory);
    }
  });
});

describe('randomSeed', () => {
  it('is URL-safe, non-empty and at most 64 chars', () => {
    for (let i = 0; i < 50; i++) {
      const s = randomSeed();
      expect(s).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });
});
