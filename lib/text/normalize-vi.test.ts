import { describe, expect, it } from 'vitest';
import { normalizeVi } from './normalize-vi';

describe('normalizeVi', () => {
  it('lowercases, strips diacritics and keeps punctuation', () => {
    expect(normalizeVi('Sơn Tùng M-TP')).toBe('son tung m-tp');
  });

  it('maps đ/Đ to d', () => {
    expect(normalizeVi('Đen')).toBe('den');
    expect(normalizeVi('đen')).toBe('den');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeVi('  Hà   Anh Tuấn ')).toBe('ha anh tuan');
  });

  it('gives the same result for NFC and NFD input', () => {
    const nfc = 'Mỹ Tâm'.normalize('NFC');
    const nfd = 'Mỹ Tâm'.normalize('NFD');
    expect(nfc).not.toBe(nfd); // guarantee the two input forms really differ
    expect(normalizeVi(nfc)).toBe('my tam');
    expect(normalizeVi(nfd)).toBe('my tam');
  });

  it('drops zero-width and soft-hyphen characters so they cannot split a match', () => {
    const [zwsp, zwnj, zwj, shy, wj, bom] = [0x200b, 0x200c, 0x200d, 0x00ad, 0x2060, 0xfeff].map((c) =>
      String.fromCharCode(c),
    );
    expect(normalizeVi(`S${zwsp}ơn T${shy}ùng${bom} M-TP${wj}`)).toBe('son tung m-tp');
    expect(normalizeVi(`Đen${zwnj}${zwj} Vâu`)).toBe('den vau');
  });

  it('treats tabs, newlines and no-break spaces as spaces', () => {
    const nbsp = String.fromCharCode(0x00a0);
    expect(normalizeVi(`Mỹ\tTâm\n${nbsp}Hà`)).toBe('my tam ha');
  });
});
