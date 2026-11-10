# Đoán Nhanh V-pop v2 (Solo) — BẢN NHÁP

> **Bản nháp, chưa dùng để thực thi.** Ngày 2026-11-10 người dùng đổi v1 thành phòng chơi nhiều người (`../2026-11-10-v1-multiplayer.md`). Các task 1–4 ở đây (scaffold, `normalizeVi`, catalog, theme) đã nằm trong v1. Khi bắt đầu v2, viết lại plan này: chỉ giữ phần solo service, bảng xếp hạng và màn hình solo, và dùng lại schema cùng các module của v1.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ra mắt bản v1: chơi solo đoán bài V-pop (10 câu, 4 đáp án, 10 giây), có duyệt và tìm theme, người chơi khách và Top 5, deploy lên Vercel + Supabase.

**Architecture:** Next.js App Router trên Vercel. Logic cần tin cậy (đồng hồ, chấm điểm) chạy trong Route Handler bằng service-role key. Supabase Postgres bật RLS để client ẩn danh không đọc được đáp án. Catalog kéo từ iTunes bằng script chạy ở máy, có bước duyệt tay.

**Tech Stack:** Next.js (App Router, TypeScript), Supabase (Postgres, Auth ẩn danh, CLI migrations), `@supabase/ssr`, Vitest + Testing Library, Playwright (e2e), `tsx` cho script.

**Spec:** `2026-11-10-roadmap.md` (mục Đã chốt, bảng tính năng các dòng v1, Kiến trúc chung, Deploy).

## Global Constraints

- Catalog chỉ V-pop (`language = 'vi'`). Giao diện tiếng Việt.
- Audio chỉ là preview iTunes (`country=VN`). Không scrape Zing MP3 / NhacCuaTui. Clip từ file nhạc riêng **không có trong v1** (D7).
- Không quảng cáo, không tracker bên thứ ba.
- Không sao chép tên, giao diện, văn bản hay nội dung của bản tham khảo.
- Hằng số trong `lib/game/config.ts`: `QUESTION_COUNT=10`, `CHOICE_COUNT=4`, `QUESTION_LIMIT_MS=10000`, `LEADERBOARD_SIZE=5`, `LEADERBOARD_TTL_DAYS=15`.
- Đáp án đúng chỉ được trả về sau khi người chơi nộp câu trả lời hoặc hết giờ. ID đáp án là chuỗi mờ.
- `SUPABASE_SERVICE_ROLE_KEY` chỉ dùng ở server (Route Handler, script). Không import vào component client; không commit.

## Review Focus

1. **Client ẩn danh gọi thẳng REST API của Supabase để đọc đáp án.** RLS phải chặn: anon không đọc được `game_questions` (Task 1).
2. **Đáp án nhiễu trùng tên bài đúng** (cùng tên khác ca sĩ, remix, "feat."). Không đáp án nhiễu nào có `titleNorm` trùng đáp án đúng (Task 5).
3. **Audio không tải được.** Đổi sang bài khác, không phạt, đồng hồ chưa chạy (Task 6, Task 9).
4. **Nộp hai lần, trả lời câu cũ, nhảy cóc chỉ số câu, trả lời trước khi begin.** Server từ chối, điểm không đổi (Task 6).
5. **Theme có ít hơn 10 bài.** Không tạo được ván hỏng; UI đánh dấu không chơi được (Task 4, Task 5).

## File Structure

```
supabase/migrations/0001_init.sql        -- bảng, index, RLS
lib/text/normalize-vi.ts
lib/catalog/itunes.ts, filter.ts, review.ts
lib/themes/themes.ts
lib/game/config.ts, scoring.ts, round-builder.ts, solo-service.ts, clock.ts
lib/players/leaderboard.ts
lib/supabase/server.ts, admin.ts          -- client theo session và client service-role
app/api/themes/route.ts
app/api/themes/[type]/[key]/leaderboard/route.ts
app/api/profile/route.ts
app/api/games/route.ts
app/api/games/[id]/route.ts
app/api/games/[id]/questions/[i]/{audio,audio-failed,begin,answer}/route.ts
app/page.tsx, app/t/[type]/[key]/page.tsx, app/play/[id]/page.tsx, app/play/[id]/result/page.tsx
app/play/[id]/useQuestionAudio.ts, useServerTimer.ts, listenLinks.ts
scripts/catalog/import-itunes.ts
catalog/artists.vpop.json, catalog/review/
```

Mỗi file `.ts` / `.tsx` có file test đứng cạnh.

---

### Task 1: Scaffold, schema và RLS

**Files:**
- Create: Next.js app, `supabase/` (`supabase init`), `supabase/migrations/0001_init.sql`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `vitest.config.ts`, `.env.local.example`
- Test: `supabase/tests/rls.test.ts` (chạy với Supabase local)

**Interfaces:**
- Produces các bảng:
  - `tracks(id, source, itunes_track_id unique, preview_url, title, title_norm, artist, artist_norm, language, genre, decade, cover_url)`
  - `profiles(id = auth.users.id, nickname, created_at)`
  - `games(id, player_id, theme_type, theme_key, status, total_points, created_at, finished_at)`
  - `game_questions(game_id, idx, track_id, choices jsonb /* [{answerId, trackId}] */, audio_track_id, started_at, answered_at, picked_answer_id, points)`
- RLS:
  - anon/authenticated `select` được `tracks` và `profiles(nickname)`.
  - Không có quyền gì trên `games` và `game_questions`. Mọi truy cập đi qua service role.
- Produces: `createServerClient()` (theo session cookie) và `createAdminClient()` (service role, chỉ dùng ở server).

- [ ] **Step 1:** `git init`, tạo Next.js app (TS, App Router), `supabase init`, thêm Vitest.
- [ ] **Step 2: Viết test RLS:** `anon can select tracks`, `anon select on game_questions returns no rows even when rows exist` (Review Focus 1), `anon cannot insert into games`.
- [ ] **Step 3: Chạy test, xác nhận FAIL** — `supabase start` rồi `npx vitest run supabase/tests/rls.test.ts`.
- [ ] **Step 4:** Viết `0001_init.sql` theo Interfaces, chạy `supabase db reset`.
- [ ] **Step 5: Chạy test, xác nhận PASS.**
- [ ] **Step 6: Commit** — `chore: scaffold app, schema and RLS`

### Task 2: Chuẩn hóa tiếng Việt

**Files:** Create `lib/text/normalize-vi.ts`; Test `lib/text/normalize-vi.test.ts`

**Interfaces:** Produces `normalizeVi(input: string): string` — hạ chữ thường, bỏ dấu, `đ`/`Đ` thành `d`, gộp khoảng trắng, trim.

- [ ] **Step 1: Viết test:** `normalizeVi('Sơn Tùng M-TP') === 'son tung m-tp'`, `normalizeVi('Đen') === 'den'`, `normalizeVi('  Hà   Anh Tuấn ') === 'ha anh tuan'`, và chuỗi NFC lẫn NFD của `'Mỹ Tâm'` cho cùng kết quả.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement** bằng `normalize('NFD')`, bỏ dấu tổ hợp, xử lý `đ` riêng.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add Vietnamese text normalization`

### Task 3: Nhập catalog từ iTunes (có duyệt tay)

**Files:** Create `lib/catalog/itunes.ts`, `filter.ts`, `review.ts`, `scripts/catalog/import-itunes.ts`; Test các file `.test.ts` cạnh từng module (dùng fixture JSON từ phản hồi thật của iTunes, không gọi mạng)

**Interfaces:**
- Consumes: `normalizeVi`, `createAdminClient`.
- Produces:
  - `searchItunes(term: string, opts: { limit: number }, fetchFn?: typeof fetch): Promise<ItunesSong[]>` — luôn gửi `country=VN&media=music&entity=song`.
  - `filterSongs(songs, artist): { kept: ItunesSong[]; dropped: { song: ItunesSong; reason: 'wrong-artist'|'variant'|'duplicate'|'no-preview' }[] }`
  - `writeReviewFile(artistKey, result, dir): Promise<string>`
  - `importReviewed(path, db): Promise<{ upserted: number }>` — upsert theo `itunes_track_id`. `decade` lấy từ `releaseDate`; curator sửa được trong file review.
- CLI:
  - `tsx scripts/catalog/import-itunes.ts` đọc `catalog/artists.vpop.json` (D6) và ghi file vào `catalog/review/`.
  - Thêm `--import <file> --target local|prod` thì mới ghi vào DB.

- [ ] **Step 1: Viết test `filterSongs`:** `drops songs whose artistName does not match` (đã quan sát: "Đen Vâu" chỉ 17/50 khớp, "Trịnh Công Sơn" 3/50), `drops remix/live/instrumental/karaoke/beat variants`, `drops duplicate titleNorm keeping the first`, `drops songs without previewUrl`.
- [ ] **Step 2: Viết test `searchItunes`:** `sends country=VN and encodes Vietnamese terms`, `throws a descriptive error on non-200`.
- [ ] **Step 3: Viết test `importReviewed`:** `is idempotent when run twice`, `respects curator overrides of genre and decade`.
- [ ] **Step 4: Chạy các test, xác nhận FAIL.**
- [ ] **Step 5: Implement** các module và CLI theo Interfaces.
- [ ] **Step 6: Chạy các test, xác nhận PASS.**
- [ ] **Step 7: Commit** — `feat: import V-pop catalog from iTunes with review step`

### Task 4: Duyệt và tìm theme

**Files:** Create `lib/themes/themes.ts`, `app/api/themes/route.ts`; Test `lib/themes/themes.test.ts`

**Interfaces:**
- Consumes: `normalizeVi`, `tracks`.
- Produces:
  - `listThemes(db, { type?: ThemeType; q?: string }): Promise<ThemeSummary[]>`, với `ThemeType = 'artist'|'genre'|'decade'` và `ThemeSummary = { type, key, label, trackCount, playable }`; `playable = trackCount >= QUESTION_COUNT`.
  - `GET /api/themes?type=&q=`.

- [ ] **Step 1: Viết test:** `q "son tung" matches "Sơn Tùng M-TP"`, `q "DEN" matches "Đen"`, `type filter returns only that type`, `theme with 9 tracks has playable=false` (Review Focus 5), `trackCount equals number of tracks in the theme`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement** bằng truy vấn nhóm trên `artist_norm` / `genre` / `decade`, tìm kiếm khớp trên cột `*_norm`.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add theme browse and search`

### Task 5: Chấm điểm và tạo ván

**Files:** Create `lib/game/config.ts`, `scoring.ts`, `round-builder.ts`; Test `scoring.test.ts`, `round-builder.test.ts`

**Interfaces:**
- Produces:
  - `scoreForAnswer(correct: boolean, timeTakenMs: number, limitMs: number): number` — theo D4. Nếu chưa chốt thì dùng tạm `correct ? max(10, round(100 * (1 - timeTakenMs / limitMs))) : 0`.
  - `buildRound(tracks: Track[], theme: ThemeRef, rng: () => number): RoundQuestion[]`, với `RoundQuestion = { trackId: string; choices: { answerId: string; trackId: string }[] }`. Ném `ThemeNotPlayableError` khi theme có ít hơn `QUESTION_COUNT` bài.

- [ ] **Step 1: Viết test `scoreForAnswer`:** `wrong scores 0`, `timeTaken >= limit scores 0`, `instant correct scores 100`, `correct at the last moment scores at least 10`, `faster never scores less than slower`.
- [ ] **Step 2: Viết test `buildRound`:** `returns 10 distinct tracks`, `each question has 4 choices with distinct titleNorm`, `no distractor shares titleNorm with the correct track` (Review Focus 2), `all distractors share the correct track's language`, `prefers same genre or decade then falls back to the language pool`, `throws ThemeNotPlayableError for 9 tracks` (Review Focus 5), `is deterministic for a seeded rng`.
- [ ] **Step 3: Chạy test, xác nhận FAIL.**
- [ ] **Step 4: Implement.** `answerId` sinh bằng `crypto.randomUUID()`, không suy ra được `trackId`.
- [ ] **Step 5: Chạy test, xác nhận PASS.**
- [ ] **Step 6: Commit** — `feat: add scoring and round builder`

### Task 6: Game API solo (server giữ đồng hồ)

**Files:** Create `lib/game/clock.ts`, `lib/game/solo-service.ts`, các route trong `app/api/games/...`; Test `lib/game/solo-service.test.ts` (chạy với Supabase local)

**Interfaces:**
- Consumes: `buildRound`, `scoreForAnswer`, `createAdminClient`, `interface Clock { nowMs(): number }`.
- Produces: `SoloService` với các phương thức tương ứng từng route. Mọi route yêu cầu có session (người chơi ẩn danh), và game phải thuộc người gọi.
  - `POST /api/games {themeType, themeKey}` → `{gameId, questionCount}`. Mỗi người chơi chỉ có 1 ván dang dở; tạo ván mới thì ván cũ thành `abandoned` [Đề xuất].
  - `GET /api/games/:id/questions/:i/audio` → `{audioUrl}`. Đồng hồ chưa chạy.
  - `POST .../audio-failed` → `{audioUrl}` của bài thay thế. Chỉ hợp lệ trước `begin`.
  - `POST .../begin` → `{choices:[{answerId,label}], deadlineAtMs, serverNowMs}`.
  - `POST .../answer {answerId?}` → `{result, points, rightAnswerId, timeTakenMs, timedOut, track:{title, artist, coverUrl}}`.
  - `GET /api/games/:id` → tổng điểm và kết quả từng câu (chỉ đầy đủ khi ván đã xong).

- [ ] **Step 1: Viết test** (dùng `Clock` giả): `begin returns choices without correctness`, `answer after deadline is timedOut with 0 points and still reveals the track`, `second answer is rejected and points unchanged` (Review Focus 4), `answer before begin is rejected`, `begin of question 3 before question 2 is resolved is rejected`, `index outside 0..9 is rejected`, `another player's game returns 404`, `audio-failed swaps the track and keeps points` (Review Focus 3), `audio-failed after begin is rejected`, `creating a new game abandons the unfinished one`, `game finishes after question 10 with totalPoints equal to the sum`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement.** `timeTakenMs = answered_at - started_at`, tính ở server. Mỗi chuyển trạng thái là một `update` có điều kiện (ví dụ `where answered_at is null`) để tránh xử lý hai lần.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add server-authoritative solo game API`

### Task 7: Người chơi khách và bảng xếp hạng

**Files:** Create `app/api/profile/route.ts`, `lib/players/leaderboard.ts`, `app/api/themes/[type]/[key]/leaderboard/route.ts`; Test `lib/players/leaderboard.test.ts`, `app/api/profile/route.test.ts`

**Interfaces:**
- Client gọi `supabase.auth.signInAnonymously()` ở lần vào đầu.
- `POST /api/profile {nickname}` ghi vào `profiles`.
- `topScores(db, theme, nowMs): Promise<{rank, nickname, points}[]>` trả tối đa `LEADERBOARD_SIZE` dòng, chỉ gồm ván đã xong trong `LEADERBOARD_TTL_DAYS` ngày gần nhất.

- [ ] **Step 1: Viết test:** `nickname empty or whitespace is rejected`, `nickname longer than 30 chars is rejected`, `returns at most 5 entries sorted by points desc`, `excludes games older than 15 days`, `excludes unfinished and abandoned games`, `the same player may appear more than once`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat: add guest profiles and leaderboard`

### Task 8: Web — trang chủ và trang theme

**Files:** Create `app/page.tsx`, `app/t/[type]/[key]/page.tsx`; Test `app/page.test.tsx`, `app/t/[type]/[key]/page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/themes`, leaderboard route, `POST /api/profile`.
- Produces:
  - Route `/`: ô tìm kiếm, bộ lọc Tất cả / Nghệ sĩ / Thể loại / Thập niên, lưới theme có số bài.
  - Route `/t/:type/:key`: nút Chơi và Top 5.
  - Nếu chưa có nickname thì hỏi trước khi chơi, có nút random nickname.

- [ ] **Step 1: Viết test:** `typing without diacritics lists the matching artist`, `non-playable theme shows a disabled Play button with a reason` (Review Focus 5), `filter chips narrow by type`, `leaderboard renders up to 5 rows`, `Play prompts for a nickname when none is set`, `random nickname button fills the field`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement** với thiết kế giao diện riêng.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat(web): add home and theme pages`

### Task 9: Web — màn chơi và màn kết quả

**Files:** Create `app/play/[id]/page.tsx`, `app/play/[id]/result/page.tsx`, `useQuestionAudio.ts`, `useServerTimer.ts`, `listenLinks.ts`; Test cạnh từng file

**Interfaces:**
- Consumes: toàn bộ API ở Task 6.
- Produces:
  - `useServerTimer(deadlineAtMs, serverNowMs): { remainingMs }` — hiệu chỉnh độ lệch đồng hồ client so với server.
  - `useQuestionAudio(audioUrl): { ready, failed, play() }`.
  - `buildListenLinks({title, artist}): {label, url}[]` (mẫu URL theo D8).

- [ ] **Step 1: Viết test:** `first question starts only after a user click`, `begin is called only after audio is ready`, `on audio failure it calls audio-failed and loads the replacement without starting the timer` (Review Focus 3), `remaining time derives from deadlineAtMs and serverNowMs offset`, `choices disable after one answer`, `reveal shows title, artist and cover from the answer response`, `history panel lists points per answered question`, `next question audio is preloaded`, `result page shows total, per-question right/wrong, replay and copy-share-text`, `buildListenLinks URL-encodes Vietnamese titles`.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement.** Mock `HTMLMediaElement` trong test.
- [ ] **Step 4: Chạy test, xác nhận PASS.**
- [ ] **Step 5: Commit** — `feat(web): add game and result screens`

### Task 10: E2E và deploy v1

**Files:** Create `e2e/solo.spec.ts`, `docs/deploy.md`, `docs/qa-checklist.md`

- [ ] **Step 1: Viết e2e `plays a full 10-question game and sees the score on the theme leaderboard`.** Chạy với Supabase local và catalog fixture. Cho phép `Clock` giả qua biến môi trường **chỉ ở môi trường test**.
- [ ] **Step 2: Chạy e2e, xác nhận PASS** — `npx playwright test`.
- [ ] **Step 3: Viết `docs/deploy.md`:**
  - Tạo 2 project Supabase (staging, production) và 1 project Vercel nối với GitHub.
  - Bật Anonymous sign-in trong Supabase Auth.
  - Đặt biến môi trường theo `.env.local.example`.
  - Trình tự release: `supabase db push` lên staging → nhập catalog vào staging → smoke test trên preview → `supabase db push` lên production → nhập catalog vào production → merge vào `main` → smoke test → gắn tag `v1.0.0`.
- [ ] **Step 4: Viết `docs/qa-checklist.md`** gồm: chơi trọn một ván trên Chrome và trên điện thoại, tìm nghệ sĩ không dấu, trình duyệt chặn autoplay, tắt mạng giữa ván, theme ít bài, và thử đọc `game_questions` bằng anon key (phải không đọc được).
- [ ] **Step 5: Deploy staging theo `docs/deploy.md`, chạy checklist, ghi kết quả vào file.**
- [ ] **Step 6: Deploy production, chạy smoke test, gắn tag `v1.0.0`.**
- [ ] **Step 7: Commit** — `chore: add e2e, deploy guide and QA checklist`
