# src/web — Thành viên 4

```
node --env-file=.env src/web/server.ts --input data/pilot/pilot.csv --run experiments/pilot/pilot-01 [--port 5173] [--provider mock]
```

Năm màn hình (M4.1) và state machine (M4.2) trong `public/app.js`. Server giữ trạng thái phiên và tự ghi `sessions/<id>.json`; event vào `events.jsonl`; thời gian tính bằng `timing.ts` (M4.3).

Chế độ thực nghiệm (M4.4): không gửi gold/expected xuống trình duyệt; participant id ẩn danh (chữ, số, `-`, `_`); không tự confirm; CONFIRM phải giữ nguyên text đề xuất, muốn đổi thì EDIT; không review lại hay ghi đè requirement đã xong. Lỗi API hiện state ERROR, server không crash.
