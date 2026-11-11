import { MAX_PLAYERS } from '@/lib/rooms/config';

/** Vietnamese messages for API error codes (see lib/rooms/route-helpers.ts). */
const MESSAGES: Record<string, string> = {
  ROOM_FULL: `Phòng đã đủ ${MAX_PLAYERS} người.`,
  LATE_JOIN_CLOSED: 'Ván đang diễn ra và chủ phòng không cho vào giữa ván. Hãy chờ ván sau.',
  ROOM_NOT_FOUND: 'Không tìm thấy phòng, hoặc phòng đã đóng.',
  NOT_HOST: 'Chỉ chủ phòng mới làm được việc này.',
  NOT_IN_ROOM: 'Bạn chưa ở trong phòng này.',
  WRONG_PHASE: 'Thao tác này không còn hợp lệ ở lúc này.',
  THEME_REQUIRED: 'Hãy chọn chủ đề trước khi bắt đầu.',
  THEME_NOT_PLAYABLE: 'Chủ đề này chưa đủ bài để chơi.',
  INVALID_SETTINGS: 'Cài đặt không hợp lệ.',
  ALREADY_ANSWERED: 'Bạn đã chọn đáp án cho câu này.',
  TOO_LATE: 'Hết giờ mất rồi!',
  NOT_IN_ROUND: 'Bạn sẽ được trả lời từ câu kế tiếp.',
  PROFILE_REQUIRED: 'Hãy đặt biệt danh trước.',
  UNAUTHENTICATED: 'Phiên đã hết hạn. Hãy tải lại trang.',
  INVALID_NICKNAME: 'Biệt danh cần từ 1 đến 30 ký tự.',
  INVALID_AVATAR_SEED: 'Avatar không hợp lệ, hãy đổi avatar khác.',
  NETWORK: 'Mất kết nối mạng. Hãy thử lại.',
  CONFLICT: 'Phòng đang bận, hãy thử lại.',
  INVALID_ANSWER: 'Đáp án không hợp lệ.',
  CODE_UNAVAILABLE: 'Chưa tạo được mã phòng, hãy thử lại.',
};

export function errorMessageVi(code: string): string {
  return MESSAGES[code] ?? 'Có lỗi xảy ra, hãy thử lại.';
}
