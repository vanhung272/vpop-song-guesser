# Deploy Đoán Nhanh V-pop

Tài liệu cho người vận hành bản phát hành: tạo hạ tầng một lần, rồi làm theo trình tự release ở mỗi phiên bản.

| Môi trường | Supabase | Vercel |
|---|---|---|
| Local | `npx supabase start` (Docker) | `npm run dev` |
| Staging | `vpop-song-guesser-staging` | Preview deployment (mỗi PR / nhánh) |
| Production | `vpop-song-guesser-prod` | Production, deploy khi merge vào `main` |

## 1. Tạo hạ tầng (một lần)

### Supabase (làm cho cả staging và prod)

1. Tạo project `vpop-song-guesser-staging` và `vpop-song-guesser-prod` (chọn region gần Việt Nam, ví dụ Singapore).
2. **Authentication → Sign In / Providers → Anonymous sign-ins: bật.** Thiếu bước này thì trình duyệt không vào được (`anonymous sign-in failed`).
3. **Realtime:** Broadcast mặc định đã bật. Kênh `room:<code>` là kênh public, nên trong **Realtime → Settings** phải giữ quyền truy cập public (không bật chế độ "chỉ kênh private"). Tin broadcast chỉ chứa `{version}`, nên dù ai cũng nghe được thì cũng không lộ đáp án.
4. Liên kết CLI rồi đẩy migration:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-staging>
   npx supabase db push
   ```
   Làm tương tự với `<ref-prod>` khi release (xem mục 3).
5. Lấy các key trong **Project Settings → API**:
   - URL và anon key: đưa lên Vercel (công khai).
   - service_role key: chỉ đưa vào biến môi trường server của Vercel, cùng các biến `CATALOG_*` trên máy của người nhập catalog. Không commit, không dán vào chat hay issue.

### Vercel

1. Tạo project `vpop-song-guesser`, import repo GitHub `vanhung272/vpop-song-guesser`. Framework là Next.js, giữ build command mặc định.
2. Đặt biến môi trường theo `.env.local.example`:

   | Biến | Preview (staging) | Production |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL của staging | URL của prod |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key của staging | anon key của prod |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role của staging | service_role của prod |

   **Không** đặt `E2E` hay `ROOM_TIMING_SCALE` trên Vercel. Code đã bỏ qua hai biến này khi `NODE_ENV=production`, nhưng đừng đặt chúng ngay từ đầu.
3. Production branch là `main`. Mỗi PR có một Preview URL dùng database staging.
4. **Region của function phải nằm cạnh Supabase.** `vercel.json` ghim function vào `sin1` (Singapore). Nếu tạo project Supabase ở region khác, hãy đổi `regions` cho khớp. Mỗi request phòng chơi gọi Supabase nhiều lần nối tiếp nhau; nếu function chạy ở region mặc định (Mỹ) thì mỗi pha tới tay người chơi trễ 1–2 s, và đáp án bị chấm muộn chừng đó nên mất điểm thưởng tốc độ. Sau khi deploy, kiểm tra ở **Project → Settings → Functions** rằng region là `sin1`.

## 2. Nhập catalog

Catalog chỉ gồm preview iTunes của danh sách ca sĩ trong `catalog/artists.vpop.json` (đây vẫn là quyết định mở D6, cần chốt danh sách trước khi lên prod).

```bash
# 1. Lấy dữ liệu từ iTunes ra file review (không đụng DB)
npm run catalog:fetch -- --all
# 2. Duyệt tay catalog/review/<artist>.json (đặt include:false cho bài sai ca sĩ / không phải V-pop)
# 3. Nhập vào staging (rồi prod khi release)
CATALOG_STAGING_SUPABASE_URL=... CATALOG_STAGING_SERVICE_ROLE_KEY=... \
  npm run catalog:import -- catalog/review/den-vau.json --target staging --yes
```

Sau khi nhập, `GET /api/themes` trên Preview phải liệt kê được các chủ đề với `playable: true` (chủ đề cần ít nhất 15 bài).

## 3. Trình tự release (ví dụ v1.0.0)

1. `npx supabase link --project-ref <ref-staging>` rồi `npx supabase db push`.
2. Nhập catalog vào staging (mục 2).
3. Mở PR; trên Preview URL chạy smoke test: tạo phòng, 2 máy vào, chơi trọn 5 câu, chơi lại (Ván mới).
4. Chạy đo tải trên staging (mục 4) và ghi kết quả vào bảng ở cuối file này.
5. Chạy `docs/qa-checklist.md` trên Preview.
6. `npx supabase link --project-ref <ref-prod>` rồi `npx supabase db push`.
7. Nhập catalog vào prod (`--target prod --yes`).
8. Merge PR vào `main`; Vercel tự deploy production.
9. Smoke test trên production (như bước 3).
10. Gắn tag: `git tag v1.0.0 && git push origin v1.0.0`.

Bản sửa lỗi tăng số patch (`v1.0.1`) và đi lại các bước 1, 3, 6, 8, 9, 10 (bước 2 và 7 chỉ cần khi catalog thay đổi).

## 4. Đo tải trên staging

`scripts/load/room-10.ts` cho R phòng × C người chơi giả chơi trọn một ván qua API thật. Mỗi người chơi giả đăng nhập ẩn danh, subscribe kênh Realtime như web client, trả lời vào lúc ngẫu nhiên và gọi `tick` khi hết pha.

```bash
NEXT_PUBLIC_SUPABASE_URL=<url staging> NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon staging> \
  npx tsx scripts/load/room-10.ts --base https://<preview-url> --rooms 3 --clients 10 --questions 5
```

- 3 × 10 = 30 lần đăng nhập ẩn danh từ một IP. Hãy kiểm tra **Authentication → Rate Limits** (mục anonymous sign-ins mỗi giờ) và nâng tạm thời nếu cần, xong thì trả về mức cũ.
- Script trả về exit code 1 nếu có phòng nào chuyển pha khác số lần cần thiết (`1 + 3 × số câu`, tức 16 lần cho 5 câu), vì như vậy nghĩa là có tick bị lặp hoặc bị nhảy vòng.
- Các cột cần xem:
  - Realtime subscribed phải là 10/10 mỗi phòng.
  - Duplicate changes phải là 0.
  - p95 của `POST answer` và `POST tick`.
  - Lỗi `CONFLICT` (xem ghi chú của Task 7 về số lần retry khi 10 người trả lời cùng lúc).
- So các con số đo được với giới hạn hiện tại của gói free: số kết nối Realtime đồng thời, số tin nhắn Realtime mỗi tháng, số lần gọi function và thời gian chạy function của Vercel Hobby. Giới hạn thay đổi theo thời gian, nên hãy tra trang pricing ở thời điểm release và ghi lại bên dưới.

### Kết quả đo

| Ngày | Môi trường | Region function / Supabase | Phòng × người | Realtime subscribed | Chuyển pha (cần) | Trùng | p95 answer | p95 tick | Lỗi | Giới hạn gói free (tra ngày đo) |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-11 | **local** (`next dev`, Supabase local, `ROOM_TIMING_SCALE=0.5`) | máy local | 1 × 4 | 4/4 | 16 (16) | 0 | 254 ms | 861 ms¹ | không có | không áp dụng |
| _chưa đo_ | staging | | 3 × 10 | | | | | | | |

¹ Số của local chỉ để kiểm tra script chạy đúng. Dev server compile route ở lần gọi đầu nên latency không đại diện cho staging.

## 5. Rủi ro của gói free

- Project Supabase free bị tạm dừng sau một thời gian không dùng; lần vào đầu sẽ lỗi cho tới khi bật lại trong dashboard.
- Realtime giới hạn số kết nối đồng thời và số tin nhắn. Mỗi người chơi giữ 1 kết nối; mỗi thay đổi trạng thái phòng gửi 1 broadcast tới mọi người trong phòng.
- Vercel Hobby chỉ cho mục đích phi thương mại, và giới hạn thời gian chạy function cũng như băng thông. `POST /start` kiểm tra HEAD từng preview (mỗi lần tối đa 3 s), nên là route chạy lâu nhất.
- Theo dõi bằng log của Vercel và Supabase. Không dùng analytics bên thứ ba.
