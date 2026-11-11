export const NICKNAME_MAX = 30;

/** Client-side mirror of the server rule: trimmed, NFC, 1..30 code points. Returns null if invalid. */
export function cleanNickname(raw: string): string | null {
  const nickname = raw.normalize('NFC').trim();
  const length = [...nickname].length;
  return length >= 1 && length <= NICKNAME_MAX ? nickname : null;
}

const CREATURES = ['Mèo', 'Cún', 'Gấu', 'Cáo', 'Thỏ', 'Cú', 'Rái Cá', 'Sóc', 'Chim Sẻ', 'Cá Heo', 'Hổ', 'Gà'];
const VIBES = [
  'Hát Rong',
  'Nghe Nhạc',
  'Mê Ballad',
  'Nhảy Giỏi',
  'Thính Tai',
  'Lắc Lư',
  'Ngân Nga',
  'Đánh Trống',
  'Huýt Sáo',
  'Gõ Phím',
  'Bắt Nhịp',
  'Mê Rap',
];

/** e.g. "Cáo Thính Tai 42". */
export function randomNickname(rng: () => number = Math.random): string {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  return `${pick(CREATURES)} ${pick(VIBES)} ${Math.floor(rng() * 90) + 10}`;
}
