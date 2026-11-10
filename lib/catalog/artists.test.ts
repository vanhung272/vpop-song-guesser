import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadArtists, parseArtists } from './artists';

describe('catalog/artists.vpop.json', () => {
  const artists = loadArtists(path.join(process.cwd(), 'catalog', 'artists.vpop.json'));

  it('is a valid seed list of about 20 artists with unique keys', () => {
    expect(artists.length).toBeGreaterThanOrEqual(20);
    expect(new Set(artists.map((a) => a.key)).size).toBe(artists.length);
  });

  it('contains the well-known artists named in the ruling', () => {
    const names = artists.map((a) => a.name);
    for (const n of ['Sơn Tùng M-TP', 'Mỹ Tâm', 'Hà Anh Tuấn', 'Hoàng Thùy Linh', 'Bích Phương', 'Binz']) {
      expect(names).toContain(n);
    }
  });
});

describe('parseArtists', () => {
  it('rejects bad shapes', () => {
    expect(() => parseArtists({})).toThrow(/array/);
    expect(() => parseArtists([{ key: 'Bad Key', name: 'x' }])).toThrow(/key/);
    expect(() => parseArtists([{ key: 'a', name: '' }])).toThrow(/name/);
    expect(() => parseArtists([{ key: 'a', name: 'A', aliases: 'x' }])).toThrow(/aliases/);
    expect(() => parseArtists([{ key: 'a', name: 'A' }, { key: 'a', name: 'B' }])).toThrow(/duplicate/);
  });
});
