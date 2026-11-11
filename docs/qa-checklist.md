# QA checklist trước khi release

Chạy trên Preview URL (database staging) trước khi merge vào `main`, và lặp lại bước 1 trên production sau khi deploy. Ghi kết quả vào bảng ở cuối file.

Chuẩn bị: một máy tính dùng Chrome, một điện thoại (iOS Safari hoặc Android Chrome), và catalog staging đã có ít nhất một chủ đề `playable`.

## 1. Chơi trên Chrome và điện thoại cùng lúc

- Chrome tạo phòng. Điện thoại quét QR trong lobby để vào phòng.
- Host đổi số câu, thời gian, chủ đề.
  - **Mong đợi:** điện thoại thấy thay đổi trong khoảng 1–2 s và không chỉnh được cài đặt.
- Bắt đầu ván. Trên điện thoại bấm **Bật âm thanh** (hoặc chọn một đáp án).
  - **Mong đợi:** nghe được clip từ câu tiếp theo; thanh thời gian của hai máy khớp nhau trong khoảng 1 s; câu, đáp án và Top 3 giống nhau trên hai máy.
- Chơi hết ván, bấm **Sao chép kết quả** rồi dán ra một chỗ khác.
  - **Mong đợi:** đoạn text có chủ đề, bảng xếp hạng và hạng của mình.

## 2. Host đóng tab giữa ván

- Ván có 3 người. Host đóng tab ở giữa một câu hỏi.
  - **Mong đợi:** ván vẫn chạy tiếp (các máy còn lại tự gọi `tick`).
  - **Mong đợi:** trong khoảng 45 s, huy hiệu "Chủ phòng" chuyển sang người còn online vào phòng sớm nhất, và người đó thấy nút **Ván mới** ở màn kết quả.

## 3. Mất mạng rồi vào lại

- Trên điện thoại bật chế độ máy bay khoảng 20 s giữa ván, rồi tắt.
  - **Mong đợi:** màn hình tự cập nhật về đúng pha hiện tại; điểm cũ vẫn còn.
- Tải lại trang (F5) giữa ván.
  - **Mong đợi:** quay lại đúng phòng, giữ điểm. Nếu là host thì vẫn là host.

## 4. Vào muộn

- Khi ván đang chạy và **Cho vào giữa ván** đang bật, một máy mới mở link phòng.
  - **Mong đợi:** thấy câu hiện tại với dòng "Bạn vào giữa vòng này…", các nút đáp án bị khóa; được trả lời từ câu kế tiếp, điểm bắt đầu từ 0.
- Tắt **Cho vào giữa ván** rồi bắt đầu một ván mới; một máy khác mở link khi ván đang chạy.
  - **Mong đợi:** thông báo "Ván đang diễn ra và chủ phòng không cho vào giữa ván. Hãy chờ ván sau."

## 5. Người thứ 11 vào phòng

- Cho 10 người vào phòng (có thể dùng nhiều cửa sổ ẩn danh hoặc nhiều trình duyệt), rồi người thứ 11 mở link.
  - **Mong đợi:** thông báo "Phòng đã đủ 10 người."

## 6. Đọc `room_rounds` bằng anon key

Thay `<url>` và `<anon>` bằng giá trị của staging:

```bash
curl "<url>/rest/v1/room_rounds?select=*" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
curl "<url>/rest/v1/room_answers?select=*" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
curl "<url>/rest/v1/tracks?select=preview_url&limit=1" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
```

- **Mong đợi:** hai lệnh đầu trả `[]` hoặc lỗi quyền (dù đang có ván chạy); lệnh thứ ba báo lỗi quyền trên cột `preview_url`.
- Trong DevTools → Network, xem response `GET /api/rooms/<code>` ở pha câu hỏi.
  - **Mong đợi:** không có `correctAnswerId`, `reveal` là `null`, và không có tên bài hay ca sĩ.

## 7. Đồng hồ máy lệch vài phút

- Trên một máy, tắt chế độ đặt giờ tự động và chỉnh đồng hồ nhanh 5 phút (sau đó chậm 5 phút).
  - **Mong đợi:** thanh thời gian và đếm ngược vẫn khớp với máy kia trong khoảng 1 s.
  - **Mong đợi:** trả lời ngay khi câu hỏi hiện ra vẫn được điểm gần mức tối đa, vì server chấm theo giờ của server.
- Nhớ bật lại chế độ đặt giờ tự động.

## Kết quả

| Ngày | Môi trường | Mục | Thiết bị | Đạt? | Ghi chú |
|---|---|---|---|---|---|
| | | 1 | | | |
| | | 2 | | | |
| | | 3 | | | |
| | | 4 | | | |
| | | 5 | | | |
| | | 6 | | | |
| | | 7 | | | |
