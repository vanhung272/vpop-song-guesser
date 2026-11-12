# Deploy Đoán Nhanh V-pop

Tài liệu cho người vận hành bản phát hành: tạo hạ tầng một lần, rồi làm theo trình tự release ở mỗi phiên bản.

v1 chỉ dùng **một project Supabase (prod)**. Chưa có người chơi thật, nên mọi bước thử (smoke test, đo tải, QA) chạy thẳng trên production trước khi chia sẻ link. Migration và catalog được thử trên Supabase local. Khi nào cần thêm staging thì xem mục 6.

| Môi trường | Supabase | Vercel |
|---|---|---|
| Local | `npx supabase start` (Docker) | `npm run dev` |
| Production | `vpop-song-guesser-prod` | Production, deploy khi push vào `main` |
| Staging | chưa dùng ở v1 (mục 6) | Preview deployment không có biến môi trường |

Các lệnh dưới đây viết cho PowerShell (Windows). Trên macOS/Linux, thay `$env:TEN='giá trị'; lệnh` bằng `TEN=giá trị lệnh`.

## 1. Tạo hạ tầng (một lần)

### Supabase

1. Tạo project trong form **Create a new project**:
   - **GitHub:** không kết nối. Migration được đẩy bằng CLI (bước 4), để chủ động lúc nào áp lên prod.
   - **Project name:** `vpop-song-guesser-prod`.
   - **Database password:** bấm *Generate a password*, lưu vào trình quản lý mật khẩu (cần khi `supabase link` / `db push`).
   - **Region:** bấm *Need a specific region?* rồi chọn **Southeast Asia (Singapore)**, khớp với `sin1` của Vercel. Không để *Auto*.
   - **Security:** giữ **Enable Data API** (bật, supabase-js cần nó). Giữ **Automatically expose new tables** như mặc định: đây là cấu hình đã chạy test, và migration `0001`/`0004` đã tự `revoke`/`grant` từng bảng nên không lộ bảng phòng chơi. Để trống **Enable automatic RLS** (migration đã bật RLS cho mọi bảng).
2. **Authentication → Sign In / Providers → Anonymous sign-ins: bật.** Thiếu bước này thì trình duyệt không vào được (`anonymous sign-in failed`).
3. **Realtime:** Broadcast mặc định đã bật. Kênh `room:<code>` là kênh public, nên trong **Realtime → Settings** phải giữ quyền truy cập public (không bật chế độ "chỉ kênh private"). Tin broadcast chỉ chứa `{version}`, nên dù ai cũng nghe được thì cũng không lộ đáp án.
4. Liên kết CLI rồi đẩy migration:
   ```powershell
   npx supabase login
   npx supabase link --project-ref <ref-prod>
   npx supabase db push --remote
   ```
   Bản CLI mới chạy `db push` vào DB **local** nếu thiếu `--remote` (nó báo "Local database is up to date"). Dòng `Target:` ở đầu output cho biết lệnh đang nhắm vào đâu; khi áp lên prod phải thấy `Target: project vpop-song-guesser-prod`.
5. Lấy các key trong **Project Settings → API**:
   - URL và anon key: đưa lên Vercel (công khai).
   - service_role key: chỉ đưa vào biến môi trường server của Vercel, cùng biến `CATALOG_PROD_SERVICE_ROLE_KEY` trên máy của người nhập catalog. Không commit, không dán vào chat hay issue.

### Vercel

1. **Add New → Project**, import repo GitHub `vanhung272/vpop-song-guesser`. Framework là Next.js, giữ build command mặc định.
2. **Trước khi bấm Deploy**, đặt biến môi trường theo `.env.local.example`, **chỉ cho môi trường Production**:

   | Biến | Production | Preview |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL của prod | để trống |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key của prod | để trống |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role của prod | để trống |

   - Để trống Preview là có chủ đích: Preview vẫn build được, nhưng khi mở chỉ hiện "Không kết nối được máy chủ" và không đụng tới DB prod. Code đang làm dở trên nhánh khác vì vậy không thể ghi dữ liệu sai vào DB thật.
   - **Không** đặt `E2E` hay `ROOM_TIMING_SCALE`. Code đã bỏ qua hai biến này khi `NODE_ENV=production`, nhưng đừng đặt chúng ngay từ đầu.
3. Production branch là `main`. `main` đã có code, nên Vercel deploy production ngay khi import. DB lúc đó chưa có catalog: **chưa chia sẻ link** cho tới cuối mục 3.
4. **Region của function phải nằm cạnh Supabase.** `vercel.json` ghim function vào `sin1` (Singapore). Nếu tạo project Supabase ở region khác, hãy đổi `regions` cho khớp. Mỗi request phòng chơi gọi Supabase nhiều lần nối tiếp nhau; nếu function chạy ở region mặc định (Mỹ) thì mỗi pha tới tay người chơi trễ 1–2 s, và đáp án bị chấm muộn chừng đó nên mất điểm thưởng tốc độ. Sau khi deploy, kiểm tra ở **Project → Settings → Functions** rằng region là `sin1`.

## 2. Catalog

Catalog chỉ gồm preview iTunes của danh sách ca sĩ trong `catalog/artists.vpop.json`. Đây là quyết định mở D6: cần chốt danh sách trước khi lên prod.

1. Lấy dữ liệu từ iTunes ra file review (không đụng DB). Lỗi 429/5xx được tự thử lại; ca sĩ nào vẫn lỗi thì bị bỏ qua và được liệt kê ở cuối, chạy lại riêng bằng `--artist <key>`.
   ```powershell
   npm run catalog:fetch -- --all
   ```
2. Duyệt tay từng file `catalog/review/<artist>.json`: đặt `include: false` cho bài sai ca sĩ, bản remix/live hoặc bài không phải V-pop; đặt `include: true` cho bài bị loại nhầm trong `dropped`.
3. Thử trên local (cần `npx supabase start`), rồi chơi vài ván:
   ```powershell
   Get-ChildItem catalog/review/*.json | ForEach-Object { npm run catalog:import -- $_.FullName --target local }
   ```
4. Commit các file review đã duyệt, để lần nhập sau ra đúng cùng một catalog.
5. Nhập vào prod:
   ```powershell
   $env:CATALOG_PROD_SUPABASE_URL='https://<ref-prod>.supabase.co'
   $env:CATALOG_PROD_SERVICE_ROLE_KEY='<service_role prod>'
   Get-ChildItem catalog/review/*.json | ForEach-Object { npm run catalog:import -- $_.FullName --target prod --yes }
   ```

Sau khi nhập, `GET https://<domain>/api/themes` phải liệt kê được các chủ đề với `playable: true` (chủ đề cần ít nhất 15 bài).

## 3. Trình tự release (ví dụ v1.0.0)

1. Migration: `npx supabase link --project-ref <ref-prod>` rồi `npx supabase db push --remote` (đã làm ở mục 1 cho lần đầu).
2. Nhập catalog vào prod (mục 2).
3. Smoke test trên link production: tạo phòng, 2 máy vào (ví dụ máy tính và điện thoại), chơi trọn 5 câu, rồi chơi lại (**Ván mới**).
4. Đo tải trên production (mục 4), ghi kết quả vào bảng ở cuối mục 4, rồi dọn dữ liệu thử.
5. Chạy `docs/qa-checklist.md` trên link production.
6. Gắn tag: `git tag v1.0.0; git push origin v1.0.0`.
7. Chia sẻ link.

Bản sửa lỗi sau khi đã có người chơi (ví dụ `v1.0.1`):
- Chạy test và e2e trên local trước.
- Nếu có migration mới, chạy thử trên Supabase local trước (`npx supabase db reset` áp lại toàn bộ migration), rồi mới `db push --remote` lên prod.
- Push vào `main` (Vercel tự deploy), smoke test, gắn tag.
- Khi bắt đầu đổi cấu trúc DB nhiều (v2), thêm staging theo mục 6.

## 4. Đo tải

`scripts/load/room-10.ts` cho R phòng × C người chơi giả chơi trọn một ván qua API thật. Mỗi người chơi giả đăng nhập ẩn danh, subscribe kênh Realtime như web client, trả lời vào lúc ngẫu nhiên và gọi `tick` khi hết pha.

Ở v1, chạy trên production **trước khi chia sẻ link**, lúc chưa có người chơi thật.

1. **Authentication → Rate Limits:** 3 × 10 = 30 lần đăng nhập ẩn danh từ một IP. Nâng tạm mục anonymous sign-ins mỗi giờ (ví dụ lên 100).
2. Chạy:
   ```powershell
   $env:NEXT_PUBLIC_SUPABASE_URL='https://<ref-prod>.supabase.co'
   $env:NEXT_PUBLIC_SUPABASE_ANON_KEY='<anon prod>'
   npx tsx scripts/load/room-10.ts --base https://<domain> --rooms 3 --clients 10 --questions 5
   ```
3. Trả Rate Limits về mức cũ.
4. Dọn dữ liệu thử, trong **SQL Editor** (chỉ làm khi chưa có phòng thật nào):
   ```sql
   delete from public.rooms;
   ```
   Xóa phòng thì xóa luôn người chơi, vòng và đáp án của phòng. 30 tài khoản ẩn danh còn lại trong **Authentication → Users** (cùng hồ sơ "Tải …" trong `profiles`); xóa nếu muốn, không ảnh hưởng gì.

Cách đọc kết quả:
- Script trả về exit code 1 nếu có phòng nào chuyển pha khác số lần cần thiết (`1 + 3 × số câu`, tức 16 lần cho 5 câu), vì như vậy nghĩa là có tick bị lặp hoặc bị nhảy vòng.
- Script cũng trả về exit code 1 nếu có lệnh gọi nào lỗi 5xx, không có phản hồi, hoặc hết lượt retry (`CONFLICT`). `TOO_LATE` và `WRONG_PHASE` là kết quả bình thường của trò chơi nên không tính.
- Các cột cần xem:
  - Realtime subscribed phải là 10/10 mỗi phòng.
  - Duplicate changes phải là 0.
  - p95 của `POST answer` và `POST tick`.
  - Lỗi `CONFLICT` (xem MAX_ATTEMPTS trong lib/rooms/room-service.ts về số lần retry khi 30 người trả lời cùng lúc).
- So các con số đo được với giới hạn hiện tại của gói free: số kết nối Realtime đồng thời, số tin nhắn Realtime mỗi tháng, số lần gọi function và thời gian chạy function của Vercel Hobby. Giới hạn thay đổi theo thời gian, nên hãy tra trang pricing ở thời điểm release và ghi lại bên dưới.

### Kết quả đo

| Ngày | Môi trường | Region function / Supabase | Phòng × người | Realtime subscribed | Chuyển pha (cần) | Trùng | p95 answer | p95 tick | Lỗi | Giới hạn gói free (tra ngày đo) |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-11 | **local** (`next dev`, Supabase local, `ROOM_TIMING_SCALE=0.5`) | máy local | 1 × 4 | 4/4 | 16 (16) | 0 | 254 ms | 861 ms¹ | không có | không áp dụng |
| _chưa đo_ | production (trước khi chia sẻ link) | | 3 × 10 | | | | | | | |

¹ Số của local chỉ để kiểm tra script chạy đúng. Dev server compile route ở lần gọi đầu nên latency không đại diện cho production.

## 5. Rủi ro của gói free

- Project Supabase free bị tạm dừng sau một thời gian không dùng; lần vào đầu sẽ lỗi cho tới khi bật lại trong dashboard.
- Realtime giới hạn số kết nối đồng thời và số tin nhắn. Mỗi người chơi giữ 1 kết nối; mỗi thay đổi trạng thái phòng gửi 1 broadcast tới mọi người trong phòng.
- Vercel Hobby chỉ cho mục đích phi thương mại, và giới hạn thời gian chạy function cũng như băng thông. `POST /start` kiểm tra HEAD từng preview (mỗi lần tối đa 3 s), nên là route chạy lâu nhất.
- Theo dõi bằng log của Vercel và Supabase. Không dùng analytics bên thứ ba.

## 6. Thêm staging (khi cần)

Thêm staging khi đã có người chơi thật **và** bắt đầu có migration đổi cấu trúc dữ liệu, hoặc khi muốn thử tính năng trên Preview URL với dữ liệu riêng. Gói free cho 2 project đang hoạt động; project bỏ không một thời gian sẽ bị tạm dừng, nên staging hay phải bật lại.

1. Tạo `vpop-song-guesser-staging` (Singapore), làm lại các bước 2–5 của mục 1 với `<ref-staging>`.
2. Trên Vercel, đặt 3 biến môi trường cho **Preview** bằng URL/key của staging.
3. Nhập catalog vào staging bằng `CATALOG_STAGING_SUPABASE_URL`, `CATALOG_STAGING_SERVICE_ROLE_KEY` và `--target staging --yes`.
4. Trình tự release khi đó: `db push --remote` và nhập catalog vào staging → mở PR, smoke test và QA trên Preview URL → đo tải trên staging → `db push --remote` và nhập catalog vào prod → merge vào `main` → smoke test production → gắn tag.
