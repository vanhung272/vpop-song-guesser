/**
 * Seeded avatars: a seed string maps deterministically to an AvatarSpec (colours + parts).
 * Only the seed is stored in the DB; every client re-derives the same picture.
 * The part set is our own design: a round "music buddy" face with optional music-themed gear.
 */

export const BACKGROUNDS = [
  '#FDE68A', // butter
  '#FBCFE8', // pink
  '#BFDBFE', // sky
  '#BBF7D0', // mint
  '#DDD6FE', // lavender
  '#FED7AA', // peach
  '#A5F3FC', // aqua
  '#E5E7EB', // mist
] as const;

export const SKIN_TONES = [
  '#F9D7B9',
  '#EDB98A',
  '#D08B5B',
  '#A0623A',
  '#6B3F24',
  '#FFB3C7', // playful pastel tones
  '#9BE3C3',
  '#B8B5FF',
] as const;

export const FACE_SHAPES = ['round', 'squircle', 'egg', 'blob', 'bean'] as const;
export const EYES = ['dots', 'wide', 'sleepy', 'wink', 'happy', 'star'] as const;
export const MOUTHS = ['smile', 'grin', 'open', 'flat', 'tongue', 'whistle'] as const;
export const ACCESSORIES = ['none', 'headphones', 'glasses', 'cap', 'bow', 'note', 'crown'] as const;

export type FaceShape = (typeof FACE_SHAPES)[number];
export type Eyes = (typeof EYES)[number];
export type Mouth = (typeof MOUTHS)[number];
export type Accessory = (typeof ACCESSORIES)[number];

export interface AvatarSpec {
  background: (typeof BACKGROUNDS)[number];
  skin: (typeof SKIN_TONES)[number];
  faceShape: FaceShape;
  eyes: Eyes;
  mouth: Mouth;
  accessory: Accessory;
}

/** FNV-1a 32-bit hash over UTF-16 code units. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: returns floats in [0, 1). */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Pure and deterministic: same seed, same spec. */
export function avatarFromSeed(seed: string): AvatarSpec {
  const rng = mulberry32(hashSeed(seed));
  return {
    background: pick(rng, BACKGROUNDS),
    skin: pick(rng, SKIN_TONES),
    faceShape: pick(rng, FACE_SHAPES),
    eyes: pick(rng, EYES),
    mouth: pick(rng, MOUTHS),
    accessory: pick(rng, ACCESSORIES),
  };
}

const SEED_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 16 URL-safe chars (96 bits) from the platform CSPRNG. */
export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += SEED_ALPHABET[b & 63];
  return out;
}
