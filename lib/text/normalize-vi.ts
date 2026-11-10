/**
 * Normalize Vietnamese text for search and matching: lowercase, strip
 * diacritics, map đ/Đ to d, collapse whitespace and trim.
 * Input may be NFC or NFD; NFD decomposition makes both forms equivalent.
 */
export function normalizeVi(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
