import { describe, expect, it, vi } from 'vitest';
import { searchItunes } from './itunes';
import sonTung from './__fixtures__/son-tung-m-tp.json';

function okResponse(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

describe('searchItunes', () => {
  it('sends country=VN and encodes Vietnamese terms', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => okResponse(sonTung));
    const songs = await searchItunes('Sơn Tùng M-TP', { limit: 50 }, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const raw = String(fetchFn.mock.calls[0][0]);
    const url = new URL(raw);
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(url.searchParams.get('country')).toBe('VN');
    expect(url.searchParams.get('media')).toBe('music');
    expect(url.searchParams.get('entity')).toBe('song');
    expect(url.searchParams.get('limit')).toBe('50');
    // decoded term round-trips and the raw URL is percent-encoded UTF-8 (no raw diacritics)
    expect(url.searchParams.get('term')).toBe('Sơn Tùng M-TP');
    expect(raw).toContain('S%C6%A1n');
    expect(raw).not.toContain('Sơn');

    expect(songs.length).toBe(sonTung.results.length);
    expect(songs[0]).toMatchObject({
      trackName: 'Đừng Làm Trái Tim Anh Đau',
      artistName: 'Sơn Tùng M-TP',
    });
    expect(typeof songs[0].trackId).toBe('number');
  });

  it('defaults to a sane limit when none is given', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      okResponse({ resultCount: 0, results: [] }),
    );
    await searchItunes('Đen Vâu', {}, fetchFn);
    expect(new URL(String(fetchFn.mock.calls[0][0])).searchParams.get('limit')).toBe('50');
  });

  it('throws a descriptive error on non-200', async () => {
    const fetchFn = vi.fn(
      async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' }) as unknown as Response,
    );
    await expect(searchItunes('Đen Vâu', { limit: 50 }, fetchFn)).rejects.toThrow(
      /iTunes search failed.*503.*Đen Vâu/,
    );
  });

  it('throws when the body is not an iTunes result list', async () => {
    const fetchFn = vi.fn(async () => okResponse({ nope: true }));
    await expect(searchItunes('x', { limit: 5 }, fetchFn)).rejects.toThrow(/unexpected/i);
  });

  it('ignores results that are not songs with a trackId', async () => {
    const body = {
      resultCount: 2,
      results: [{ wrapperType: 'artist', artistName: 'X' }, sonTung.results[0]],
    };
    const fetchFn = vi.fn(async () => okResponse(body));
    const songs = await searchItunes('x', { limit: 5 }, fetchFn);
    expect(songs).toHaveLength(1);
  });
});
