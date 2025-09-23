Artimind OutPut
================

Ứng dụng tĩnh để duyệt dữ liệu từ Google Sheet, gom nhóm mỗi video theo quy tắc:
- Success: 3 dòng (style, category, output)
- Fail: 2 dòng (style, category)

Cách dùng
---------
1) Mở file `index.html` trong trình duyệt hoặc chạy `python3 -m http.server` rồi mở http://127.0.0.1:8099/.
2) Dán URL Google Sheet vào ô và bấm "Tải danh sách".
   Ví dụ: https://docs.google.com/spreadsheets/d/1JY0GzK2sCLsz4njaiGEwAn49PXlkaI4I3f_LJ7jfMZs/edit?gid=478131050#gid=478131050
3) Dùng mũi tên (← → ↑ ↓), Home/End để điều hướng; có phân trang và bộ lọc multi-select có bộ đếm.

Trường hiển thị
---------------
- MP4, Style Name, Category Name, geo_country, event_timestamp, Output URL.

Ghi chú kỹ thuật
----------------
- Tải CSV qua các endpoint của Google Sheets, fallback proxy nếu cần, hoặc GViz JSONP.
- Chỉ hiển thị các bản ghi success.
