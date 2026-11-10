# Đoán Nhanh V-pop v1 (Phòng chơi nhiều người) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ra mắt v1: host tạo phòng có mã 5 số, tối đa 10 người vào bằng link hoặc mã, cùng nghe clip V-pop và chọn đáp án theo từng vòng, có xếp hạng trực tiếp và rematch. Deploy lên Vercel + Supabase.

**Architecture:**
- Không có server chạy liên tục. Trạng thái phòng là một máy trạng thái lưu trong Postgres; mỗi pha có `phase_ends_at`.
- Client nào thấy hết giờ thì gọi `tick`. Server chỉ chuyển pha khi `now()` đã qua hạn, và dùng `version` (optimistic concurrency) để nhiều lần `tick` cùng lúc chỉ chuyển pha một lần.
- Sau mỗi thay đổi, server gửi một tín hiệu Supabase Realtime Broadcast chỉ chứa `version`. Client nhận tín hiệu thì gọi `GET` lấy snapshot. Snapshot từ API là nguồn sự thật duy nhất, nên một tin broadcast giả chỉ gây ra thêm một lần fetch.

**Tech Stack:** Next.js App Router (TypeScript) trên Vercel; Supabase (Postgres + RLS, Auth ẩn danh, Realtime Broadcast, CLI migrations); `@supabase/ssr`; Vitest + Testing Library; Playwright (e2e nhiều người chơi); `qrcode` (tạo QR); `tsx` (script).

**Spec:** `2026-11-10-roadmap.md` — các dòng v1 trong bảng tính năng, mục v1, Kiến trúc chung, Deploy. Các quyết định đã chốt ngày 2026-11-10: 10 người mỗi phòng, thưởng tốc độ tuyến tính, vào muộn thì chơi từ vòng kế tiếp, avatar vẽ ngẫu nhiên bằng canvas.

## Global Constraints

- Catalog chỉ V-pop (`language = 'vi'`). Audio chỉ là preview iTunes (`country=VN`). Không scrape Zing MP3 / NhacCuaTui. Không có clip từ file nhạc riêng (D7).
- Giao diện tiếng Việt. Không quảng cáo, không tracker bên thứ ba. Không sao chép tên, giao diện, văn bản, nhân vật hay nội dung của bản tham khảo.
- Hằng số trong `lib/rooms/config.ts`:
  - Lấy từ bản tham khảo hoặc đã chốt:
    - `MAX_PLAYERS = 10`
    - `ROOM_CODE_LENGTH = 5`
    - `QUESTION_COUNT_OPTIONS = [5, 8, 10, 12, 15]`
    - `TIME_LIMIT_OPTIONS_MS = [10000, 15000, 20000]`, mặc định `15000`
    - `COUNTDOWN_MS = 3000`
    - `CHOICE_COUNT = 4`
  - [Đề xuất], chỉnh được:
    - `PRESENT_MS = 3000`
    - `REVEAL_MS = 6000`
    - `HEARTBEAT_MS = 15000`
    - `OFFLINE_AFTER_MS = 45000`
    - `ROOM_IDLE_CLOSE_MS = 30 * 60 * 1000`
- Điểm mỗi câu:
  - Câu ở vòng `n` (tính từ 1): `base = 500 + 50 * (n - 1)` và `maxBonus = 300 + 50 * (n - 1)`.
  - Đúng: `base + round(maxBonus * remainingMs / limitMs)`. Sai hoặc hết giờ: `0`.
- Đáp án đúng chỉ xuất hiện trong snapshot khi phòng ở pha `reveal`. Đây là chỗ sửa lỗi của bản tham khảo, vốn gửi tên bài đúng tới client trước khi ai trả lời.
- `SUPABASE_SERVICE_ROLE_KEY` chỉ dùng ở server. Không import vào code client; không commit.

## Review Focus

1. **Client ẩn danh đọc đáp án qua REST hoặc Realtime của Supabase.** RLS chặn mọi bảng phòng chơi; snapshot không có `correctAnswerId` trước pha `reveal` (Task 1, Task 7).
2. **Hai client gọi `tick` cùng lúc, hoặc gọi lặp lại.** Pha chỉ chuyển một lần, không bị nhảy hai vòng (Task 6, Task 7).
3. **Host đóng tab giữa lobby hoặc giữa ván.** Quyền host chuyển cho người chơi online vào phòng sớm nhất; ván vẫn chạy tiếp vì client nào cũng gọi `tick` được (Task 6) [Đề xuất].
4. **Người thứ 11 vào phòng, vào khi ván đang chạy mà late join tắt, hoặc vào một mã phòng đã đóng.** Server từ chối với thông báo rõ ràng (Task 7).
5. **Đồng hồ máy người chơi lệch vài phút.** Thanh thời gian tính theo độ lệch so với server; đáp án được chấm theo giờ server (Task 7, Task 10).

## Luồng phòng chơi

```
lobby --start(host)--> countdown --(3s)--> presenting(n) --(PRESENT_MS)--> question(n)
question(n) --(hết giờ)--> reveal(n) --(REVEAL_MS)--> presenting(n+1) | results
results --rematch(host)--> lobby   (game_no + 1, điểm về 0)
```

- Loại câu: `title` ("Bài gì?") hoặc `artist` ("Ca sĩ nào?") [O]. Bản tham khảo không cho biết cách chọn loại câu, nên đề xuất: theme là nghệ sĩ thì chỉ dùng `title`; theme khác thì chọn ngẫu nhiên, và câu `artist` phải có 4 ca sĩ khác nhau.
- Người vào muộn có `joined_round = vòng hiện tại + 1`, điểm bắt đầu từ 0.

## File Structure

```
supabase/migrations/0001_init.sql            -- tracks, profiles, rooms, room_players, room_rounds, room_answers, RLS
lib/text/normalize-vi.ts
lib/catalog/itunes.ts, filter.ts, review.ts  -- + scripts/catalog/import-itunes.ts
lib/themes/themes.ts
lib/rooms/config.ts, scoring.ts, round-builder.ts
lib/rooms/state-machine.ts                   -- logic thuần, không đụng DB
lib/rooms/room-repo.ts                       -- đọc và ghi trạng thái có kiểm tra version
lib/rooms/room-service.ts                    -- nối state machine, repo và notify
lib/rooms/notify.ts                          -- Realtime Broadcast {version}
lib/rooms/snapshot.ts                        -- dựng snapshot riêng cho từng người gọi
lib/avatar/avatar.ts, Avatar.tsx             -- avatar vẽ bằng canvas từ seed
lib/supabase/server.ts, admin.ts
app/api/profile/route.ts
app/api/themes/route.ts
app/api/rooms/route.ts                       -- POST tạo phòng
app/api/rooms/[code]/route.ts                -- GET snapshot
app/api/rooms/[code]/{join,leave,settings,theme,start,tick,answer,heartbeat,rematch}/route.ts
app/page.tsx                                 -- tạo phòng / nhập mã
app/r/[code]/page.tsx                        -- lobby + game + results
app/r/[code]/useRoom.ts, useServerClock.ts, useRoundAudio.ts
```

---

### Task 1: Scaffold, schema và RLS

**Files:** Next.js app, `supabase init`, `supabase/migrations/0001_init.sql`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `.env.local.example`; Test `supabase/tests/rls.test.ts`

**Interfaces:**
- Produces các bảng:
  - `tracks(id, itunes_track_id unique, preview_url, title, title_norm, artist, artist_norm, language, genre, decade, cover_url)`
  - `profiles(id = auth.users.id, nickname, avatar_seed, created_at)`
  - `rooms(id, code, host_id, game_no, phase, round_idx, phase_ends_at, settings jsonb {questionCount, timeLimitMs, showLiveAnswers, lateJoin}, theme_type, theme_key, version int, last_activity_at, closed_at)`
  - `room_players(room_id, player_id, joined_at, joined_round, score, last_seen_at, left_at)`
  - `room_rounds(room_id, game_no, idx, track_id, question_type, choices jsonb [{answerId, label}], correct_answer_id, started_at, deadline_at)`
  - `room_answers(room_id, game_no, idx, player_id, answer_id, answered_at, points)`, khóa chính `(room_id, game_no, idx, player_id)`
  - Index unique một phần trên `rooms(code) where closed_at is null`.
- RLS:
  - anon/authenticated được `select` `tracks` và `profiles(nickname, avatar_seed)`.
  - Bốn bảng `rooms*` **không cấp quyền gì** cho anon/authenticated. Mọi truy cập đi qua service role.

- [ ] **Step 1:** Tạo Next.js app, `supabase init`, thêm Vitest. Git đã được khởi tạo sẵn: remote `origin` = `https://github.com/vanhung272/vpop-song-guesser.git`, tác giả commit cấp repo `Hung Nguyen <nvhung0207002@gmail.com>`. Metadata của app (`<title>`, manifest) dùng tên "Đoán Nhanh V-pop".
- [ ] **Step 2: Viết test RLS:** `anon can select tracks`, `anon select on room_rounds returns no rows even when rows exist` (Review Focus 1), `anon select on room_answers returns no rows`, `anon cannot insert into rooms`.
- [ ] **Step 3: Chạy test, xác nhận FAIL** — `supabase start` rồi `npx vitest run supabase/tests/rls.test.ts`.
- [ ] **Step 4:** Viết migration theo Interfaces, chạy `supabase db reset`.
- [ ] **Step 5: Chạy test, xác nhận PASS.**
- [ ] **Step 6: Commit** — `chore: scaffold app, schema and RLS`

### Task 2: Chuẩn hóa tiếng Việt

**Files:** `lib/text/normalize-vi.ts`; Test `normalize-vi.test.ts`

**Interfaces:** Produces `normalizeVi(input: string): string` — hạ chữ thường, bỏ dấu, `đ`/`Đ` thành `d`, gộp khoảng trắng, trim.

- [ ] **Step 1: Viết test:** `normalizeVi('Sơn Tùng M-TP') === 'son tung m-tp'`, `normalizeVi('Đen') === 'den'`, `normalizeVi('  Hà   Anh Tuấn ') === 'ha anh tuan'`, và chuỗi NFC lẫn NFD của `'Mỹ Tâm'` cho cùng kết quả.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement** bằng `normalize('NFD')`, bỏ dấu tổ hợp, xử lý `đ` riêng.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add Vietnamese text normalization`

### Task 3: Nhập catalog từ iTunes (có duyệt tay)

**Files:** `lib/catalog/itunes.ts`, `filter.ts`, `review.ts`, `scripts/catalog/import-itunes.ts`, `catalog/artists.vpop.json` (D6); Test cạnh từng module (dùng fixture JSON từ phản hồi thật, không gọi mạng)

**Interfaces:**
- `searchItunes(term, { limit }, fetchFn?): Promise<ItunesSong[]>` — luôn gửi `country=VN&media=music&entity=song`.
- `filterSongs(songs, artist): { kept; dropped: { song; reason: 'wrong-artist'|'variant'|'duplicate'|'no-preview' }[] }`
- `writeReviewFile(artistKey, result, dir)`
- `importReviewed(path, db): Promise<{ upserted }>` — upsert theo `itunes_track_id`. `decade` lấy từ `releaseDate`; curator sửa được trong file review.
- CLI: mặc định ghi file vào `catalog/review/`; thêm `--import <file> --target local|staging|prod` thì mới ghi vào DB.

- [ ] **Step 1: Viết test:** `drops songs whose artistName does not match` (đã quan sát: "Đen Vâu" 17/50, "Trịnh Công Sơn" 3/50), `drops remix/live/instrumental/karaoke/beat variants`, `drops duplicate titleNorm keeping the first`, `drops songs without previewUrl`, `searchItunes sends country=VN and encodes Vietnamese terms`, `searchItunes throws a descriptive error on non-200`, `importReviewed is idempotent`, `importReviewed respects curator overrides`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement** các module và CLI.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: import V-pop catalog from iTunes with review step`

### Task 4: Duyệt và tìm theme (để host chọn quiz)

**Files:** `lib/themes/themes.ts`, `app/api/themes/route.ts`; Test `themes.test.ts`

**Interfaces:** `listThemes(db, { type?, q? }): Promise<ThemeSummary[]>`, với `ThemeSummary = { type: 'artist'|'genre'|'decade', key, label, trackCount, playable }`. `playable` khi số bài ≥ số câu lớn nhất có thể chọn.

- [ ] **Step 1: Viết test:** `q "son tung" matches "Sơn Tùng M-TP"`, `q "DEN" matches "Đen"`, `type filter returns only that type`, `trackCount equals number of tracks in the theme`, `theme with fewer than 15 tracks reports playable=false`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement** bằng truy vấn nhóm trên cột `*_norm`, `genre`, `decade`.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add theme browse and search`

### Task 5: Chấm điểm và tạo bộ câu hỏi

**Files:** `lib/rooms/config.ts`, `scoring.ts`, `round-builder.ts`; Test `scoring.test.ts`, `round-builder.test.ts`

**Interfaces:**
- `pointsFor(roundNumber: number, correct: boolean, remainingMs: number, limitMs: number): number` — công thức trong Global Constraints.
- `pointsOnOffer(roundNumber): { base, maxBonus }` — dùng cho thẻ giới thiệu vòng.
- `buildRounds(tracks: Track[], theme: ThemeRef, count: number, rng): BuiltRound[]`, với `BuiltRound = { trackId, questionType: 'title'|'artist', choices: { answerId, label }[], correctAnswerId }`.

- [ ] **Step 1: Viết test `pointsFor`:** `wrong is 0`, `round 1 instant correct is 800`, `round 1 correct with 0ms left is 500`, `round 3 instant correct is 1000` (600 + 400), `round 1 half time left is 650`, `faster never scores less than slower`.
- [ ] **Step 2: Viết test `buildRounds`:** `returns count rounds with distinct tracks`, `each round has 4 distinct labels`, `no title-question distractor shares titleNorm with the correct track`, `artist questions have 4 distinct artists`, `artist themes only produce title questions`, `throws ThemeNotPlayableError when tracks < count`, `is deterministic for a seeded rng`.
- [ ] **Step 3: Chạy test, xác nhận FAIL.**
- [ ] **Step 4: Implement.** `answerId` sinh bằng `crypto.randomUUID()`.
- [ ] **Step 5: Chạy test, xác nhận PASS.**
- [ ] **Step 6: Commit** — `feat: add room scoring and round builder`

### Task 6: Máy trạng thái phòng (logic thuần)

**Files:** `lib/rooms/state-machine.ts`; Test `state-machine.test.ts`

**Interfaces:**
- Types: `RoomState` (phase, roundIdx, phaseEndsAt, hostId, settings, gameNo, version, players[]) và `Command = Start | Tick | Answer | Join | Leave | Heartbeat | UpdateSettings | UpdateTheme | Rematch`.
- `apply(state: RoomState, cmd: Command, nowMs: number): { state: RoomState; effects: Effect[] } | RoomError`
  - `Effect` gồm `CreateRounds`, `RecordAnswer`, `AddScore`, …
  - `RoomError` là một trong `'NOT_HOST'|'WRONG_PHASE'|'ROOM_FULL'|'LATE_JOIN_CLOSED'|'ALREADY_ANSWERED'|'TOO_LATE'|'NOT_IN_ROUND'`.
- Mọi chuyển trạng thái thành công đều tăng `version` thêm 1.

- [ ] **Step 1: Viết test:**
  - `Start only by host and only in lobby`.
  - `Tick before phaseEndsAt is a no-op that does not bump version` (Review Focus 2).
  - `Tick after phaseEndsAt moves countdown→presenting→question→reveal→presenting(next)→…→results`.
  - `two Ticks with the same expected version produce one transition` (Review Focus 2).
  - `Answer accepted only in question phase and before deadline`.
  - `second Answer by the same player is ALREADY_ANSWERED`.
  - `Answer from a player whose joined_round is later is NOT_IN_ROUND`.
  - `Join rejects the 11th player with ROOM_FULL`.
  - `Join during a game with lateJoin=false is LATE_JOIN_CLOSED`.
  - `Join during a game with lateJoin=true sets joined_round to current+1 and score 0`.
  - `when the host is offline longer than OFFLINE_AFTER_MS the host passes to the earliest-joined online player` (Review Focus 3).
  - `UpdateSettings rejects values outside the allowed options`.
  - `Rematch from results returns to lobby, increments gameNo and resets scores`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement** dưới dạng reducer thuần. Không gọi DB hay đồng hồ hệ thống; thời gian luôn truyền vào qua `nowMs`.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add room state machine`

### Task 7: Room API, lưu trữ và realtime

**Files:** `lib/rooms/room-repo.ts`, `room-service.ts`, `notify.ts`, `snapshot.ts`, các route trong `app/api/rooms/...`; Test `room-service.test.ts`, `snapshot.test.ts` (chạy với Supabase local)

**Interfaces:**
- Consumes: `apply`, `buildRounds`, `createAdminClient`, `Clock`.
- `RoomRepo.save(state, expectedVersion)` cập nhật có điều kiện `where version = expectedVersion`. Nếu không có dòng nào được cập nhật thì đọc lại trạng thái và trả về (người khác đã chuyển pha trước).
- `notifyRoomChanged(code, version)` gửi Broadcast lên channel `room:<code>`, event `changed`.
- `buildSnapshot(state, rounds, answers, viewerId, nowMs): RoomSnapshot`:
  - Gồm `serverNowMs`, phase, `phaseEndsAt`, danh sách người chơi (nickname, avatarSeed, score, online), câu hiện tại (choices), đáp án của chính người xem, và phần trăm mỗi đáp án nếu `showLiveAnswers` bật.
  - `correctAnswerId`, Top 3 vòng và track (title, artist, cover) **chỉ có ở pha `reveal`**.
  - `audioUrl` của câu hiện tại và câu kế tiếp có từ pha `presenting` để client tải trước.
- Routes (người gọi phải có session ẩn danh và đã có profile):
  - `POST /api/rooms` → `{code}`.
  - `GET /api/rooms/:code` → `RoomSnapshot`.
  - `POST /join`, `POST /leave`, `PATCH /settings`, `PATCH /theme`, `POST /start`, `POST /tick`, `POST /answer {answerId}`, `POST /heartbeat`, `POST /rematch`.
  - Lỗi `RoomError` trả về 409 kèm mã lỗi; phòng không tồn tại hoặc đã đóng trả về 404.
  - `start` dựng các vòng bằng `buildRounds` và kiểm tra trước từng `preview_url` bằng request HEAD; bài nào hỏng thì đổi bài khác trước khi tạo vòng.

- [ ] **Step 1: Viết test:**
  - `snapshot in question phase has no correctAnswerId and no track info` (Review Focus 1).
  - `snapshot in reveal phase includes correctAnswerId, top3 and track`.
  - `live answer percentages appear only when showLiveAnswers is true`.
  - `concurrent tick calls produce exactly one phase change in the DB` (chạy 5 `tick` song song; Review Focus 2).
  - `answer timing uses server clock: remaining time comes from deadline_at minus server receive time` (Review Focus 5).
  - `11th join returns 409 ROOM_FULL` (Review Focus 4).
  - `join to a closed room returns 404` (Review Focus 4).
  - `create room generates a 5-digit code unique among open rooms`.
  - `start replaces a track whose preview URL fails the HEAD check`.
  - `every successful command calls notifyRoomChanged with the new version`.
  - `room with no heartbeat for ROOM_IDLE_CLOSE_MS is closed on next access`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add room API with realtime notifications`

### Task 8: Profile khách và avatar vẽ bằng canvas

**Files:** `lib/avatar/avatar.ts`, `lib/avatar/Avatar.tsx`, `app/api/profile/route.ts`; Test `avatar.test.ts`, `Avatar.test.tsx`, `route.test.ts`

**Interfaces:**
- `avatarFromSeed(seed: string): AvatarSpec` — hàm thuần, xác định. Từ seed suy ra màu nền, hình khuôn mặt, mắt, miệng, phụ kiện. Bộ hình do mình tự thiết kế.
- `<Avatar seed size />` vẽ `AvatarSpec` lên `<canvas>`.
- `randomSeed(): string`.
- `POST /api/profile {nickname, avatarSeed}`. DB chỉ lưu seed.
- Client gọi `supabase.auth.signInAnonymously()` ở lần vào đầu.

- [ ] **Step 1: Viết test:** `same seed returns identical spec`, `different seeds produce different specs for at least 95 of 100 random seeds`, `spec values stay within the defined palettes and part counts`, `Avatar renders a canvas with the given size`, `nickname empty or longer than 30 chars is rejected`, `avatarSeed longer than 64 chars is rejected`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement.** Dùng PRNG có seed (ví dụ mulberry32 trên hash của seed) để chọn các thành phần.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add guest profile with seeded canvas avatars`

### Task 9: Web — trang chủ và lobby

**Files:** `app/page.tsx`, `app/r/[code]/page.tsx` (phần lobby), `app/r/[code]/useRoom.ts`; Test `page.test.tsx`, `lobby.test.tsx`, `useRoom.test.ts`

**Interfaces:**
- `useRoom(code): { snapshot, send(cmd) }`:
  - Subscribe Broadcast `room:<code>`. Khi nhận `version` mới hơn thì gọi `GET` snapshot.
  - Khi kết nối lại thì cũng fetch lại snapshot.
  - Gửi heartbeat mỗi `HEARTBEAT_MS`.
- Trang chủ:
  - Nút Tạo phòng và ô nhập mã 5 số.
  - Lần đầu vào thì thiết lập nickname (có nút random) và avatar (nút đổi avatar sinh seed mới).
- Lobby:
  - Danh sách người chơi (`x/10`) có huy hiệu host; link mời, nút copy, QR, ẩn/hiện mã phòng.
  - Host chỉnh cài đặt và chọn theme (tìm kiếm qua `GET /api/themes`), bấm Bắt đầu.
  - Người khác thấy các lựa chọn của host trực tiếp.

- [ ] **Step 1: Viết test:** `entering a 5-digit code navigates to /r/<code>`, `non-digit or wrong-length codes are rejected inline`, `first visit asks for nickname and shows a random avatar`, `useRoom refetches when a broadcast carries a newer version and ignores older ones`, `non-host sees settings read-only`, `host sees settings controls with only the allowed options`, `ROOM_FULL and LATE_JOIN_CLOSED show a Vietnamese error message`, `invite link copies the full URL`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement** với thiết kế giao diện riêng.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat(web): add home and lobby`

### Task 10: Web — màn chơi và kết quả

**Files:** `app/r/[code]/page.tsx` (các pha còn lại), `useServerClock.ts`, `useRoundAudio.ts`; Test `game.test.tsx`, `useServerClock.test.ts`, `useRoundAudio.test.ts`

**Interfaces:**
- `useServerClock(serverNowMs): { nowMs() }` — hiệu chỉnh độ lệch giữa đồng hồ client và server.
- `useRoundAudio(currentUrl, nextUrl): { ready, failed, playAt(startMs) }` — tải trước câu kế tiếp, phát khi tới giờ server.
- Màn hình theo pha:
  - Đếm 3-2-1.
  - Thẻ vòng "Vòng n/N" kèm số điểm có thể nhận.
  - Câu hỏi: thanh thời gian và 4 nút đáp án; % trực tiếp nếu bật.
  - Đáp án: bài thật, Top 3 vòng, điểm của bạn.
  - Tab Bảng xếp hạng / Lịch sử.
  - Kết quả cuối: xếp hạng, nút copy text chia sẻ, và nút Ván mới (chỉ host).
- Mỗi client gọi `tick` khi tới `phaseEndsAt` theo đồng hồ server, cộng thêm một khoảng ngẫu nhiên 0–300 ms để không dồn request.

- [ ] **Step 1: Viết test:**
  - `audio needs one user click before the first question` (trình duyệt chặn autoplay).
  - `timer uses server offset: with client clock 5 minutes ahead it still shows the correct remaining time` (Review Focus 5).
  - `choices lock after one answer and show "Bạn đã chọn"`.
  - `a late joiner sees the current round as spectator and can answer from the next round`.
  - `when audio fails the player sees a message and can still answer`.
  - `reveal shows title, artist, cover, top 3 and own points`.
  - `round card shows base and max bonus for that round`.
  - `client calls tick once when the phase ends`.
  - `results page shows the final ranking and copies share text`.
  - `only the host sees the new game button`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement.** Mock `HTMLMediaElement` và Broadcast trong test.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat(web): add game and results screens`

### Task 11: E2E, đo tải và deploy v1

**Files:** `e2e/room.spec.ts`, `scripts/load/room-10.ts`, `docs/deploy.md`, `docs/qa-checklist.md`

- [ ] **Step 1: Viết e2e `host and two guests play a 5-question game, see the same rounds, and the ranking matches the sum of points`.** Dùng 3 browser context, Supabase local và catalog fixture. Cho phép rút ngắn thời gian các pha qua biến môi trường **chỉ ở môi trường test**.
- [ ] **Step 2: Viết e2e `rematch returns everyone to the lobby with scores reset`.**
- [ ] **Step 3: Chạy e2e, xác nhận PASS** — `npx playwright test`.
- [ ] **Step 4: Viết `docs/deploy.md`:**
  - Tạo 2 project Supabase (`vpop-song-guesser-staging`, `vpop-song-guesser-prod`), bật Anonymous sign-in và Realtime.
  - Tạo 1 project Vercel `vpop-song-guesser` nối với repo GitHub `vanhung272/vpop-song-guesser`; đặt biến môi trường theo `.env.local.example`.
  - Trình tự release: `supabase db push` lên staging → nhập catalog → smoke test trên preview → `supabase db push` lên production → nhập catalog → merge vào `main` → smoke test → tag `v1.0.0`.
- [ ] **Step 5: Đo tải trên staging:** `tsx scripts/load/room-10.ts` mở 3 phòng × 10 client giả, chơi trọn một ván. Ghi lại số kết nối Realtime, thời gian phản hồi API, và có tick nào bị lặp hay không. So với giới hạn gói free hiện tại và ghi kết quả vào `docs/deploy.md`.
- [ ] **Step 6: Viết `docs/qa-checklist.md` và chạy:**
  - Chơi trên Chrome và trên điện thoại cùng lúc.
  - Host đóng tab giữa ván.
  - Mất mạng rồi vào lại.
  - Vào muộn.
  - Người thứ 11 vào phòng.
  - Đọc `room_rounds` bằng anon key (phải không đọc được).
  - Chỉnh đồng hồ máy lệch vài phút.
- [ ] **Step 7: Deploy production, smoke test, gắn tag `v1.0.0`.**
- [ ] **Step 8: Commit** — `chore: add e2e, load check, deploy guide and QA checklist`
