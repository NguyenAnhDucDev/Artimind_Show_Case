# Artimind Showcase

## Chạy bằng Node.js (khuyến nghị)

Yêu cầu: Node.js >= 18

1) Cài dependencies:

```bash
npm install
```

2) Chạy server dev (có proxy CORS):

```bash
npm run dev
```

Server sẽ chạy ở: `http://localhost:8099`

Frontend sẽ gọi `GET /proxy?url=...` để tải Google Sheet CSV/GViz tránh lỗi CORS.

3) Sản xuất:

```bash
npm start
```

Ghi chú: Nếu dùng Node < 18, hãy nâng cấp Node hoặc thay fetch built-in bằng `node-fetch`.

## Artimind OutPut – Project Documentation

### Overview
Artimind OutPut là ứng dụng web tĩnh phục vụ duyệt dữ liệu video sinh ra từ hệ thống theo nguồn Google Sheets. Ứng dụng nhóm các dòng dữ liệu GA (Google Analytics export) thành các bản ghi video, cung cấp bộ lọc đa tiêu chí theo thời gian thực và điều hướng nhanh bằng bàn phím.

### Data Model & Grouping
- Nguồn dữ liệu: Google Sheet (CSV/Visualization JSONP), yêu cầu chia sẻ công khai "Ai có liên kết" hoặc quyền truy cập phù hợp.
- Chuẩn gom nhóm:
  - Success record = 5 dòng liên tiếp theo `event_params.key`: `input1`, `input2`, `style`, `category`, `output` (ứng với `event_name` chứa "success").
  - Fail records được bỏ qua (không xử lý).
  - Legacy/fallback = scan lần lượt, gom `input1` → `input2` → `style` → `category` → `output` nếu không có `event_name`.
- Các cột chính được nhận diện linh hoạt theo tên gần đúng (case-insensitive):
  - `event_name`, `event_params.key`, `event_params.value.string_value`, `event_timestamp`, `geo.country` (hoặc `geo_country`/`country`)
  - `subscription_status`
  - `user_pseudo_id`

### Fields per video record
- `input1Url` (link ảnh input đầu tiên)
- `input2Url` (link ảnh input thứ hai)
- `styleName` (Style Name)
- `categoryName` (Category Name)
- `country` (geo.country)
- `subscriptionStatus` (đặc biệt đánh dấu `subscription_cancelled_by_user`)
- `userPseudoId`
- `timestamp` (event_timestamp)
- `outputUrl` (link MP4)

### Key Features
1) Google Sheet Loader
   - Ưu tiên GViz JSONP (tránh CORS) → fallback CSV qua proxy `r.jina.ai` khi cần.
   - Chỉ báo lỗi nếu không tải được dữ liệu nào (tránh alert giả).

2) Real‑time Faceted Filters (Multi‑select)
   - Country, Category, Style, Subscription, User.
   - Mỗi mục có checkbox + bộ đếm; danh sách lựa chọn cập nhật realtime theo các filter đang chọn (facet counts).

3) Horizontal Chip Strip (Top Navigation)
   - Dải thẻ nằm ngang bên trên video, số thẻ = "Mỗi trang".
   - Hiển thị mỗi thẻ 3–5 dòng: tag `subscription_status` (nếu có), Style, Category, Country, User.
   - Thẻ có `subscription_cancelled_by_user` được viền đỏ nổi bật.
   - Auto-scroll đảm bảo thẻ đang chọn luôn trong vùng nhìn thấy; có nút ‹ › để cuộn.

4) Keyboard Navigation
   - ←/→: chuyển 1 thẻ; ↑/↓: nhảy theo "cột" ảo bằng đúng "Mỗi trang".
   - Home/End: về đầu/cuối dải trên trang hiện tại; tự chuyển trang khi cần.

5) Video Player
   - Tự động phát khi chọn thẻ; hiển thị link MP4 bên dưới.

### Getting Started
1) Serve tĩnh (khuyến nghị để tránh hạn chế file://):
   ```bash
   python3 -m http.server 8099 --bind 127.0.0.1
   # mở http://127.0.0.1:8099/
   ```
2) Trong ứng dụng, dán URL Google Sheet vào ô "Sheet URL" và bấm "Tải danh sách".
3) Sử dụng các filter để thu hẹp kết quả; số thẻ hiển thị ăn theo ô "Mỗi trang".

### Architecture
- `index.html`: khung UI, bộ lọc, dải thẻ, player.
- `styles.css`: theme tối, chip strip, tag trạng thái, multi-select panel.
- `main.js`:
  - Loader (GViz JSONP/CSV proxy), parser CSV đơn giản.
  - Nhận diện cột linh hoạt, gom nhóm triplet, bỏ qua `#N/A`.
  - Quản lý state filter, facet count realtime, pagination, keyboard nav, autoplay.

### Notes & Limitations
- Yêu cầu sheet cho phép đọc công khai hoặc đúng quyền; nếu không có dữ liệu, app mới hiển thị cảnh báo.
- Parser CSV dùng phương pháp đơn giản (quote, newline) – đủ cho export chuẩn của Sheets.
- Khi số lượng giá trị filter quá lớn (ví dụ user), panel hiển thị theo tần suất giảm dần; có thể mở rộng thêm ô search nếu cần.

### Customization
- Thêm/bớt trường, đổi nhãn filter, chỉnh số thẻ mặc định, đổi màu tag… đều có thể cấu hình nhanh trong `main.js`/`styles.css`.

### Troubleshooting
- Không tải được sheet: kiểm tra quyền chia sẻ, thử mở trực tiếp link export CSV; hoặc dán link khác để kiểm chứng.
- Không thấy `subscription_status`/`user_pseudo_id`: xác minh tiêu đề cột tồn tại; app tìm theo tên gần đúng nhưng cần có dữ liệu.

### License
Internal project document. Use per your organization's policy.