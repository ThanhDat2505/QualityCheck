# Annotation Guide

> **Version:** v0.1-draft · **Owner:** Thành viên 1 · **Status:** đang soạn, chưa dùng để gắn nhãn chính thức
>
> Các mục đánh dấu **`TODO`** là chỗ nhóm cần quyết định hoặc bổ sung. Xóa dấu `TODO` khi đã chốt.

## 1. Mục đích

Guide này dùng để gắn nhãn chất lượng cho từng requirement trong `data/sampled/requirements.csv`. Kết quả sau adjudication là `data/annotations/gold.csv`, dùng để đánh giá Quality Gate (Precision/Recall/F1 so với Gate prediction).

Guide chỉ xét **3 nhóm vấn đề**, không xét gì khác (chính tả, văn phong, tính khả thi kỹ thuật, ...):

1. **Ambiguity**: mơ hồ.
2. **Incompleteness for the intended diagram**: thiếu thông tin cho diagram mục tiêu.
3. **Potential inconsistency**: có khả năng mâu thuẫn với requirement khác.

## 2. Nguyên tắc bắt buộc

- Gắn nhãn **độc lập**: không trao đổi với annotator khác trước khi nộp.
- **Không xem** kết quả của Quality Gate (rule hints, LLM output) khi gắn nhãn.
- Đánh giá **đúng câu như được viết**, không dựa vào hiểu biết riêng về domain để "lấp chỗ trống". Nếu phải tự bịa thêm thông tin thì đó là dấu hiệu của vấn đề.
- Chỉ dùng thông tin trong: `requirement_text`, `context_before`, `context_after`, `target_diagram` và các requirement trong `related_requirement_ids`.
- Lỗi do chuyển đổi PDF (ví dụ "u nits", "can' mt ove") **không** tính là ambiguity, trừ khi nó làm thay đổi nghĩa. `TODO: chốt quy tắc này`

## 3. Đơn vị gắn nhãn và thông tin đầu vào

Mỗi dòng trong `requirements.csv` là một đơn vị. Annotator đọc:

| Cột | Dùng để |
|---|---|
| `requirement_text` | Câu cần đánh giá |
| `context_before`, `context_after` | Giải nghĩa đại từ hoặc thuật ngữ; **không** dùng để bổ sung yêu cầu mới |
| `target_diagram` | Xác định "đủ thông tin" theo diagram nào (USE_CASE / CLASS / SEQUENCE) |
| `related_requirement_ids` | Các requirement cùng section, hoặc vế còn lại của một cặp ghim; dùng để kiểm tra inconsistency |
| `sampling` | `RANDOM` hoặc `PINNED_PAIR`. **Annotator không được dùng cột này để suy ra nhãn**: cặp ghim chỉ là ứng viên, có thể vẫn là CLEAR nếu hai câu không thực sự xung đột |

## 4. Nhãn

Mỗi requirement nhận **đúng một** nhãn:

| Nhãn | Dùng khi |
|---|---|
| `CLEAR` | Không có vấn đề nào trong 3 nhóm |
| `AMBIGUOUS` | Chỉ có vấn đề mơ hồ |
| `INCOMPLETE_FOR_TARGET` | Chỉ có vấn đề thiếu thông tin cho diagram mục tiêu |
| `POTENTIAL_INCONSISTENCY` | Chỉ có vấn đề có thể mâu thuẫn |
| `MULTIPLE_ISSUES` | Có từ 2 nhóm vấn đề trở lên; ghi đủ các vấn đề trong `reason` |

Thứ tự kiểm tra gợi ý: (1) có mơ hồ không → (2) với `target_diagram`, có vẽ được mà không phải bịa không → (3) so với các requirement liên quan, có xung đột không.

### 4.1 CLEAR

**Định nghĩa:** Chỉ có một cách hiểu hợp lý, và đủ thông tin để vẽ phần diagram mục tiêu tương ứng mà không phải tự thêm actor/class/message. Không có xung đột với requirement liên quan.

**Positive example:**
- *"The driver shall be able to adjust the contrast of the display."* (USE_CASE). Actor, hành động và đối tượng đều rõ. (smoke S001)
- *"The maximum length of a message segment shall be 96 characters. A message can include several segments."* (CLASS). Có thực thể, quan hệ nhiều-một và ràng buộc. (smoke S002)

**Negative example:** *"The system shall be easy to use."* Không phải CLEAR vì "easy" không đo được.

**Boundary case:** Câu dùng thuật ngữ chuẩn của domain (ví dụ "valid telephone number" trong GSM-R) mà không định nghĩa lại. `TODO: chốt — thuật ngữ chuẩn có cần định nghĩa trong context không?`

**Không được suy diễn:** Không được coi là CLEAR chỉ vì "ai trong ngành cũng hiểu". Nếu cần kiến thức ngoài văn bản để vẽ diagram thì phải ghi rõ trong `reason`.

### 4.2 AMBIGUOUS

**Định nghĩa:** Có hơn một cách hiểu hợp lý, hoặc có từ/tham chiếu không đủ rõ để mô hình hóa an toàn. Dấu hiệu thường gặp:
- Từ định tính, không đo được: *quickly, adequate, easy, appropriate, sufficient, high, user-friendly* ...
- Đại từ hoặc tham chiếu không xác định được, kể cả sau khi đọc context: *it, this, these, they* ...
- Điều kiện không xác định: *where appropriate, if necessary, as required* ...
- Ngưỡng/placeholder chưa điền: *<xx> hours*. `TODO: chốt — placeholder là AMBIGUOUS hay INCOMPLETE_FOR_TARGET?`

**Positive example:**
- *"The System must provide adequate response times for commonly performed functions under both standard and peak conditions."* Span: `adequate; commonly performed functions`. (smoke S004)
- *"... shall be able to bring the ... system quickly to a safe state upon detection of danger."* Span: `quickly; danger`. (smoke S005)

**Negative example:** *"The system shall be able to validate credit card in less than 2 seconds."* Không mơ hồ: ngưỡng thời gian rõ ràng. Nếu có vấn đề thì là thiếu thông tin cho diagram (xem 4.3).

**Boundary case:** *"Where appropriate, these checks should also be performed during operation."* "these checks" **được giải** nhờ `context_before` (validity and feasibility checks) nên không tính, nhưng "Where appropriate" vẫn mơ hồ → AMBIGUOUS, span chỉ là `Where appropriate`. (smoke S006)

**Không được suy diễn:**
- Không gắn AMBIGUOUS cho **mọi** đại từ. Chỉ gắn khi không xác định được tham chiếu từ câu và context.
- Không tự chọn một cách hiểu "hợp lý nhất" rồi coi là rõ.

### 4.3 INCOMPLETE_FOR_TARGET

**Định nghĩa:** Câu hiểu được, nhưng **thiếu thông tin cần cho diagram mục tiêu**: muốn vẽ thì phải tự bịa thêm actor, class, attribute, participant hoặc message.

Thông tin tối thiểu theo từng diagram. `TODO: nhóm review cùng Thành viên 5 để khớp với NormalizedUmlModel`

| target_diagram | Cần có |
|---|---|
| `USE_CASE` | Actor (ai thực hiện hoặc hưởng lợi) và mục tiêu/hành động của actor |
| `CLASS` | Các thực thể chính và ít nhất thuộc tính hoặc quan hệ giữa chúng |
| `SEQUENCE` | Các participant, ai khởi tạo, các message trao đổi và thứ tự cơ bản |

**Positive example:**
- *"The system shall be able to validate credit card in less than 2 seconds."* (SEQUENCE). Thiếu người khởi tạo, dịch vụ thanh toán bên ngoài và cách xử lý phản hồi. (smoke S007)
- *"The driver shall be able to consult train data when the train is stationary or moving."* (CLASS). Không biết "train data" gồm những gì. (smoke S008)

**Negative example:** Cũng câu *"The driver shall be able to consult train data ..."* nhưng với `target_diagram = USE_CASE` thì **đủ**: có actor (driver) và mục tiêu (consult train data). Cùng một câu có thể đủ cho diagram này nhưng thiếu cho diagram khác.

**Boundary case:** Thông tin còn thiếu nằm trong `context_before`/`context_after`. `TODO: chốt — context có được dùng để bù incompleteness không, hay chỉ để giải nghĩa?`

**Không được suy diễn:** Không đánh giá "thiếu" theo cảm tính chung; chỉ theo `target_diagram` của dòng đó.

### 4.4 POTENTIAL_INCONSISTENCY

**Định nghĩa:** Requirement này và ít nhất một requirement khác **có vẻ** không tương thích (cùng điều kiện nhưng hành vi khác nhau, ngưỡng khác nhau, quyền khác nhau ...). Nhãn này chỉ là **"có khả năng"**: cần stakeholder xác nhận trước khi kết luận là mâu thuẫn thật. Bắt buộc ghi `related_requirement_ids`.

**Positive example:**
- *"The driver shall be able to release an ETCS emergency brake application when stationary."* và *"If decided by a national value, the driver may release the ETCS emergency brake when the actual speed is below the permitted speed."* Một câu chỉ cho nhả phanh khi đứng yên, câu kia cho nhả khi đang chạy. Có thể là ngoại lệ có chủ đích → cần stakeholder xác nhận. (smoke S009 ↔ S010)

**Negative example:** Hai câu nói cùng một việc với từ khác nhau (ví dụ "visual and audible indication" và "visual and audible alarm" cho cùng điều kiện pin yếu) là **trùng lặp**, không phải mâu thuẫn.

**Boundary case:** Một câu là trường hợp tổng quát, câu kia là ngoại lệ được nói rõ ("unless ...", "except ..."). `TODO: chốt — ngoại lệ được nêu rõ thì có còn là POTENTIAL_INCONSISTENCY không?`

**Không được suy diễn:**
- Không ghi "mâu thuẫn chắc chắn" hay "requirement sai".
- Chỉ so với các requirement trong `related_requirement_ids` (và context). `TODO: chốt — có được so với requirement khác cùng tài liệu không nằm trong related_requirement_ids không?`

### 4.5 MULTIPLE_ISSUES

**Định nghĩa:** Có từ 2 trong 3 nhóm vấn đề trên.

**Positive example:** `TODO: thêm ví dụ thật từ dataset` (ví dụ một câu vừa có từ "quickly" vừa thiếu participant cho SEQUENCE).

**Cách ghi:** `issue_span` liệt kê các span, cách nhau bằng `;`. `reason` ghi từng vấn đề kèm loại, ví dụ `AMBIGUITY: ...; INCOMPLETENESS: ...`. Nếu một vấn đề là inconsistency thì ghi `related_requirement_ids`.

## 5. Quy tắc riêng cho dataset này

`TODO: Thành viên 1 chốt từng quy tắc`

| # | Tình huống | Quy tắc |
|---|---|---|
| 1 | Câu không phải requirement (giả định, tiền điều kiện, mô tả bối cảnh) | `TODO` (gợi ý: báo lại để thay câu, không gắn nhãn) |
| 2 | `shall` / `should` / `will` / `may` | `TODO` (gợi ý: mức độ bắt buộc không tính là ambiguity) |
| 3 | Mã ưu tiên EIRENE `(M)` / `(O)` ở cuối câu | Bỏ qua khi đánh giá |
| 4 | Câu có nhiều câu con (2–3 câu trong một requirement) | `TODO` |
| 5 | Tham chiếu tới tài liệu ngoài ("as defined in EN 301 515") | `TODO` |
| 6 | Yêu cầu phi chức năng (hiệu năng, nền tảng) với `target_diagram` không phù hợp | `TODO` |

## 6. Các trường cần ghi

Ghi vào bản sao của `data/annotations/annotation-template.csv`, đặt tên `annotations-<annotator_id>.csv`.

| Trường | Bắt buộc | Giá trị |
|---|---|---|
| `annotator_id` | Có | Mã ẩn danh, ví dụ `A1`, `A2` (không dùng tên thật) |
| `requirement_id` | Có | Có sẵn trong template |
| `label` | Có | Một trong 5 nhãn ở mục 4 |
| `issue_span` | Khi label ≠ CLEAR | Đoạn text **chép nguyên văn** từ requirement; nhiều span cách nhau bằng `;` |
| `reason` | Khi label ≠ CLEAR | 1–2 câu giải thích |
| `needs_clarification` | Có | `yes` / `no` |
| `suggested_question` | Khi `needs_clarification = yes` | Câu hỏi ngắn nhất để stakeholder làm rõ |
| `confidence` | Có | 1 (rất không chắc) đến 5 (rất chắc) |
| `related_requirement_ids` | Khi có inconsistency | ID cách nhau bằng `;` |

## 7. Quy trình

1. Đọc hết guide và thử gắn nhãn 10 câu trong `data/fixtures/smoke.csv`, rồi so với `expected_label`. **Không** dùng smoke để đo agreement chính thức.
2. Mỗi requirement có ít nhất 2 annotator gắn nhãn độc lập.
3. Thành viên 1 gộp kết quả và liệt kê các câu bất đồng.
4. Cả nhóm adjudication: thảo luận từng câu bất đồng, ghi lý do quyết định.
5. Nhãn cuối cùng ghi vào `data/annotations/gold.csv` và **freeze** trước khi chấm Gate.
6. Tính percent agreement và Cohen's kappa (nếu có 2 annotator) trên nhãn trước adjudication.

Nếu trong lúc gắn nhãn phát hiện guide thiếu quy tắc: ghi vào mục 8, **không** tự sửa nhãn đã nộp; nhóm sẽ cập nhật guide rồi quyết định có cần gắn nhãn lại không.

## 8. Câu hỏi mở và lịch sử thay đổi

| Ngày | Phiên bản | Thay đổi / câu hỏi |
|---|---|---|
| 2026-10-08 | v0.1-draft | Khung ban đầu, ví dụ lấy từ `data/fixtures/smoke.csv` |
