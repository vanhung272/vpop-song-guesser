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
});
