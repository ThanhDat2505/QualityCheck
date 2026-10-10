# Review notes — dataset v0.1 draft (sample 3)

Written for: Thành viên 1, trước khi freeze `requirements.csv` v0.1 và bắt đầu gắn nhãn chính thức.

Nguồn: đọc toàn bộ 120 dòng kèm context (annotator `A0`, file `data/annotations/annotations-A0-claude.csv`). Nhãn của A0 do LLM gắn, **không dùng làm gold**; chỉ dùng để đối chiếu khi adjudication.

## 0. Thay đổi so với mẫu 2 (quyết định của nhóm ngày 2026-10-08)

| Quyết định | Cách thực hiện |
|---|---|
| Bỏ hẳn PEPPOL | `EXCLUDED_DOCS` trong script giờ gồm peering, get real, peppol. Còn 15 tài liệu, 8 dòng mỗi tài liệu = 120 |
| Chủ động thêm cặp mâu thuẫn | `pinned-pairs.csv`: 5 cặp chọn tay từ `candidates-all.csv`, luôn có trong mẫu, cột `sampling = PINNED_PAIR`, `related_requirement_ids` trỏ sang vế kia |
| Sửa 5 lỗi trích xuất | Câu dẫn danh sách kết thúc bằng ":" bị loại; tiêu đề/nhãn mục dính vào câu bị loại hoặc cắt; không tách câu trong cặp ngoặc kép; tiêu đề EIRENE sau marker (M)/(O) bị cắt; tiêu đề viết hoa toàn bộ ở đầu câu bị cắt |

Nhờ seed riêng theo tài liệu, mẫu 3 giữ 83/120 dòng của mẫu 2; A0 gắn nhãn mới 37 dòng.

### Cặp ghim

| Cặp | Dòng | Nội dung xung đột tiềm ẩn |
|---|---|---|
| P1 themas | R025 ↔ R032 | Thermostat chỉ cung cấp giá trị/cài đặt nhiệt độ, nhưng event ghi "thermostat that made the request" |
| P2 video search | R109 ↔ R110 | Kết quả từ video link site không có length/date, nhưng kết quả được sắp xếp theo length/date |
| P3 ertms | R091 ↔ R094 | Lái tàu nhả phanh khẩn cấp trực tiếp khi dừng, so với phanh được nhả qua việc xác nhận train trip |
| P4 gamma j | R009 ↔ R014 | Backup định kỳ qua internet, so với backup qua USB khác |
| P5 qheadache | R052 ↔ R055 | Hiển thị điểm của nhiều người chơi, so với "only one user per machine" |

P1, P2 là xung đột khá rõ; P3–P5 ở mức "cần stakeholder xác nhận" (A0 cho confidence 2). Annotator **không được** dùng cột `sampling` để suy ra nhãn: nếu thấy hai câu không xung đột thì vẫn gắn CLEAR.

**Bắt buộc ghi vào experiment protocol:** 10/120 dòng được chọn có chủ đích; báo cáo Gate detection cho tập ngẫu nhiên (110) và tập đầy đủ (120) riêng.

## 1. `target_diagram`

39 dòng được gán lại bằng tay trong `target-diagram-overrides.csv`. Phân bố: **83 USE_CASE / 23 CLASS / 14 SEQUENCE**.

## 2. Phân bố nhãn của A0

| Nhãn | Số dòng | Ghi chú |
|---|---|---|
| CLEAR | 59 | |
| AMBIGUOUS | 38 | |
| INCOMPLETE_FOR_TARGET | 13 | phần lớn là tham chiếu sang bảng/hình/phụ lục |
| POTENTIAL_INCONSISTENCY | 7 | tất cả thuộc cặp ghim |
| MULTIPLE_ISSUES | 3 | R009, R014, R052: vừa mơ hồ vừa thuộc cặp ghim |

Không có dòng ngẫu nhiên nào được A0 gắn POTENTIAL_INCONSISTENCY; điều này khớp với mẫu 2 và là lý do phải ghim cặp.

## 3. Dòng nên thay trước khi freeze

Thay bằng câu cùng tài liệu từ `candidates-all.csv` (tránh câu đã dùng trong `smoke.csv` và `pinned-pairs.csv`).

### 3a. Không phải requirement của hệ thống (18 dòng, nên thay)

| ID | Lý do |
|---|---|
| R016 | Nghĩa vụ của nhà cung cấp (Yoggie) |
| R017, R019, R022 | Gemini: ghi chú thông tin, phát biểu về quy trình phát triển, nhiệm vụ lập kế hoạch |
| R033, R039 | dii: nghĩa vụ của sponsor, phương pháp kiểm định |
| R040 | dii: hướng dẫn viết XML trong phụ lục, "they" không có tham chiếu |
| R045, R048 | tcs: ràng buộc mua sắm, mô tả chương trình QA |
| R059, R060 | microcare: bước thủ công của người dùng / nhân viên VSP |
| R072 | phin: con trỏ sang tài liệu khác |
| R104 | keepass: phát biểu thông tin về file format |
| R112 | video search: nghĩa vụ của development team |
| R114–R117 | blitdraft: nghĩa vụ của project/development team; R114 còn được đánh dấu "(Example)" trong tài liệu gốc |

### 3b. Yêu cầu phi chức năng / ràng buộc, không có UML target (16 dòng, nhóm quyết định giữ hay thay)

R003, R007, R008, R012, R038, R043, R044, R046, R053, R056, R075, R076, R081, R102, R106, R120.

Gợi ý: giữ 5–8 câu rõ ràng và đo được (R008, R043, R053, R081, R102) để kiểm tra Gate có báo false positive trên NFR hay không; thay phần còn lại.

### 3c. Tài liệu nguồn

- **dii** vẫn yếu: 3/8 không phải requirement (R033, R039, R040), 3/8 trỏ sang hình/phụ lục (R035, R036, R037). Nếu thay, ưu tiên các câu "The XS shall …" ở mục 4.x.
- **gemini**: tài liệu viết dạng văn xuôi, nhiều câu là lập luận hơn là yêu cầu; 3/8 cần thay.

## 4. Cách A0 giải quyết các `TODO` trong annotation guide

Nhóm cần chốt lại; A0 đã áp dụng như sau để có nhãn nhất quán:

| TODO | Cách A0 áp dụng |
|---|---|
| Placeholder `[SYSTEM NAME]`, `[company name]` | **AMBIGUOUS**, span là chính placeholder (R116, R117, R119) |
| Khoảng thay vì ngưỡng ("within 5-8 seconds") | AMBIGUOUS (R006, R007) |
| Danh sách mở ("such as", "e.g.", "etc.") | AMBIGUOUS khi danh sách đó chính là nội dung cần mô hình hóa (R020, R069, R107) |
| Context có bù được incompleteness không | **Có**, nếu context nêu rõ thuộc tính/actor (R024, R050, R067); không nếu chỉ có một phần (R077) |
| Đại từ giải được bằng context | Không tính (R026 "the process"); AMBIGUOUS nếu context cũng không nêu tên (R027 "It", R031 "This procedure", R105 "They") |
| Lỗi chuyển PDF | Không tính nếu không đổi nghĩa ("t he", "wh en", "asction"); tính nếu đổi nghĩa (R054 "0.05x", R100 folder/file, R101) |
| Tham chiếu tài liệu ngoài | CLEAR nếu bản thân câu đã có nghĩa và tài liệu ngoài chỉ bổ sung chi tiết (R071, R073–R076); **INCOMPLETE_FOR_TARGET** nếu toàn bộ nội dung cần vẽ nằm ở hình/bảng/phụ lục (R029, R035, R036, R079, R080) |
| Actor không được nêu ("it shall be possible to…") | INCOMPLETE_FOR_TARGET với USE_CASE (R095, R096, R111); công cụ đơn người dùng (keepass, qheadache) coi "user" là mặc định |
| "As an objective", "should be a goal", "whenever possible" | AMBIGUOUS vì không rõ có bắt buộc (R020, R041) |
| Potential inconsistency | Gắn cho **cả hai** câu trong cặp, mỗi câu trỏ sang câu kia; nếu câu còn có vấn đề khác thì MULTIPLE_ISSUES (R009, R014, R052) |
| Câu không phải requirement | Vẫn gắn nhãn theo 3 tiêu chí, confidence 1–2, và liệt kê ở mục 3a để thay |

## 5. Độ tin cậy

Confidence trung bình của A0: 3,3/5. Các dòng confidence ≤ 2 (R016, R022, R033, R039, R048, R055, R059, R060, R072, R091, R094, R104, R109, R110) gồm mục 3a và ba cặp ghim yếu; không nên dùng để đối chiếu.
