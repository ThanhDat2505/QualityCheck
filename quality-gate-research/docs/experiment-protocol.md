# Experiment Protocol

> Version v0.1-draft · cập nhật 2026-10-13 · **chưa freeze**. Freeze (Checkpoint E) trước khi chạy main experiment; sau đó mọi thay đổi phải ghi vào mục 11 và không được dựa trên kết quả main.

## 1. Câu hỏi nghiên cứu và giả thuyết

- **RQ1:** Thêm Requirement Quality Gate trước UML-generation pipeline có cải thiện chất lượng UML sinh ra không?
- **RQ2:** Mức cải thiện đó có đáng với human clarification effort phát sinh thêm không?
- **H1:** UML sinh từ requirement đã qua Gate và clarification có F1 cao hơn UML sinh trực tiếp từ cùng requirement gốc.
- **H2:** Requirement đã confirm sau Gate còn ít vấn đề chưa giải quyết hơn requirement ban đầu.

RQ2 được trả lời như một trade-off (mục 8.5), không kết luận "đáng" chỉ dựa vào F1.

## 2. Thiết kế

Within-subject, hai condition trên **cùng** tập requirement:

| | Condition A — Baseline | Condition B — Quality Gate |
|---|---|---|
| Đầu vào generator | text gốc | text đã qua Gate, làm rõ và được người confirm/edit |
| UML generator | **cùng một** generator cố định | **cùng một** generator cố định |
| Reference UML, normalization, scoring | giống nhau | giống nhau |

Biến độc lập duy nhất: Quality Gate OFF/ON.

## 3. Dataset

- Nguồn: PURE (Ferrari et al., RE'17), 18 tài liệu XML trong `data/raw/XMLZIPFile`. Đã loại peering, get real, PEPPOL (lý do trong `data/sampled/review-notes.md`).
- Tập đánh giá: `data/sampled/requirements.csv`, 120 dòng, 15 tài liệu, `source_type = REAL`. Dựng lại được bằng `npm run data:build` (seed 392).
- **Lấy mẫu có chủ đích:** 10 dòng `sampling = PINNED_PAIR` (5 cặp ứng viên potential inconsistency chọn tay, vì lấy mẫu ngẫu nhiên gần như không có mẫu loại này). Mọi chỉ số Gate detection và UML được báo cáo **hai lần**: tập đầy đủ (120) và tập ngẫu nhiên (110). `summary.json` tính sẵn cả hai (`randomOnly`).
- Smoke fixture (`data/fixtures/smoke.csv`, 10 dòng) và pilot set **không** thuộc tập đánh giá; script đã loại text của smoke khỏi mẫu.
- Version: `Dataset version: v0.1` khi Thành viên 1 freeze (sau khi thay các dòng ở `review-notes.md` mục 3).

## 4. Cấu hình hệ thống (freeze sau pilot)

Ghi tự động vào `manifest.json` của mỗi run:

| Thành phần | Giá trị hiện tại | Nơi định nghĩa |
|---|---|---|
| Contract | v0.1 | `src/types/qualityGate.ts` |
| Rules | v0.1 | `src/rules/ruleChecker.ts` |
| Prompts (Gate) | v0.1 | `src/llm/prompts.ts` |
| Decision engine | v0.1 | `src/gate/decisionEngine.ts` |
| LLM | `claude-opus-5-5`, effort `medium`, `fallbacks: "default"` | `.env` / `src/llm/anthropicProvider.ts` |
| UML generator | `llm-uml:anthropic:claude-opus-5-5:medium:uml-v0.1` | `src/uml/UmlGeneratorAdapter.ts` |
| Normalization | v0.1 | `src/uml/normalize.ts` |
| Metrics | v0.1 | `src/evaluation/metrics.ts` |
| Max clarification rounds | 2 | `src/gate/clarificationSession.ts` |

## 5. Quyết định M5.1 — UML generator

**Quyết định (2026-10-13):** nhóm không có code/data của implementation requirement-to-UML trong paper gốc. Thực nghiệm dùng một **generator thay thế cố định**: LLM (cùng model và effort như trên) với prompt `uml-v0.1`, output chuẩn hóa sang `NormalizedUmlModel`. Generator này dùng cho **cả hai** condition.

Hệ quả:
- Nghiên cứu là **prototype / replication adaptation**, không claim tái lập kết quả của tác giả gốc.
- Generator id được ghi vào mọi file baseline/treatment; `summary.json` có `sameGeneratorForBothConditions` và phải là `true`.
- Nếu sau này có implementation gốc: tạo class mới implement `UmlGenerator`, chạy lại **cả hai** condition trong một run mới.

## 6. Quy ước đo

### 6.1 Normalization tên (v0.1)
Tách camelCase/snake_case/kebab-case → chữ thường → bỏ ký tự không phải chữ/số → bỏ mạo từ đầu (the/a/an) → chuyển từ cuối về số ít (quy tắc đơn giản: -ies→-y, -ches/-shes/-xes/-ses→bỏ -es, -s→bỏ, trừ -ss/-us/-is và từ ≤ 3 ký tự). Relationship so khớp theo bộ (from, to, type); message theo (from, to, name).

### 6.2 Field được chấm
| Diagram | Field |
|---|---|
| USE_CASE | actors, useCases, relationships |
| CLASS | classes, operations, relationships |
| SEQUENCE | actors, classes (participants), messages |

Field không thuộc diagram bị xóa trước khi chấm.

### 6.3 Precision / Recall / F1
Đếm TP/FP/FN gộp (micro) trên các field được chấm của **một** requirement. Quy ước biên: không sinh gì và reference rỗng → P=R=F1=1; một trong hai rỗng → 0. Tổng hợp theo diagram và toàn bộ bằng **macro** (trung bình theo requirement). `delta_f1 = gate_f1 − baseline_f1`.

### 6.4 Text không đổi
Nếu Gate trả CLEAR hoặc người confirm giữ nguyên text gốc, treatment **dùng lại** output baseline (cùng generator id) thay vì gọi generator lần nữa. Mục đích: Δ F1 của các requirement này bằng 0 theo định nghĩa, không chứa nhiễu do LLM sinh output khác nhau giữa hai lần gọi. File treatment ghi `reusedFromBaseline: true`.

### 6.5 Gate detection
So nhãn Gate (`gateResultToLabel`) với `gold.csv`. Positive = có vấn đề (mọi nhãn ≠ CLEAR). Báo cáo P/R/F1, false-positive rate trên requirement gold CLEAR, false-negative rate trên requirement gold có vấn đề, accuracy 5 nhãn, P/R/F1 theo từng nhãn.

## 7. Quy trình

1. **Checkpoint A–C (đã đạt với mock):** `npm run check` pass; `npm run smoke:mock` chạy 10/10 không lỗi, không copy file tay.
2. **Smoke với Claude:** đặt `ANTHROPIC_API_KEY`, chạy `npm run smoke`. Kiểm tra: 10/10 có output, không có `failures`, log có đủ call.
3. **Pilot (mục 9 của kế hoạch):** 10–20 requirement **không** thuộc tập đánh giá (lấy từ `candidates-all.csv`, tránh smoke và mẫu chính) → `data/pilot/pilot.csv`. Chạy `gate`, `baseline`, review bằng web UI (`experiments/pilot/<run>`), `treatment`, `score`. Được sửa: crash, UI khó hiểu, xử lý JSON lỗi, rule sai rõ ràng, prompt instruction, logging. **Mỗi lần sửa prompt phải tăng version.** Sau pilot: freeze (Checkpoint D).
4. **Gold labels (mục 10):** ít nhất 2 annotator độc lập trên `annotation-template.csv`, không thấy Gate prediction và không thấy file A0; adjudication → `data/annotations/gold.csv`; freeze trước khi chấm Gate. Báo cáo percent agreement và Cohen's kappa (`cohensKappa` trong `src/evaluation/gateMetrics.ts`).
5. **Reference UML (M5.4):** nhóm tạo `data/reference/<requirement_id>.json` theo `NormalizedUmlModel` cho **text đã làm rõ ý định** của mỗi requirement, ≥ 2 người review; freeze trước main experiment.
6. **Main experiment:** run mới `experiments/main/<run-id>`:
   ```
   npm run experiment -- gate      --input data/sampled/requirements.csv --run experiments/main/<run-id>
   npm run experiment -- baseline  --input data/sampled/requirements.csv --run experiments/main/<run-id>
   npm run web -- --input data/sampled/requirements.csv --run experiments/main/<run-id>    # người tham gia review
   npm run experiment -- treatment --input data/sampled/requirements.csv --run experiments/main/<run-id>
   npm run experiment -- score     --input data/sampled/requirements.csv --run experiments/main/<run-id> --reference data/reference --gold data/annotations/gold.csv
   ```
   Người tham gia đóng vai stakeholder: chỉ dựa vào tài liệu nguồn PURE để trả lời, không xem reference UML và gold.

## 8. Kết quả cần báo cáo

Lấy từ `results.csv` và `summary.json`, theo bảng mục 13 của kế hoạch.

1. **Gate detection** (`summary.gateDetection`): P, R, F1, FP rate trên clear, FN rate trên problematic; tập đầy đủ và tập ngẫu nhiên.
2. **Chất lượng requirement** (`summary.requirementIssues`): số issue trước, số issue chưa giải quyết sau recheck, tỷ lệ recheck thành CLEAR.
3. **Chất lượng UML** (`summary.uml`): P/R/F1 baseline và gate, theo diagram và toàn bộ; Δ F1.
4. **Human effort** (`summary.humanEffort`): thời gian làm rõ trung bình, số câu hỏi trên requirement, intervention rate, tỷ lệ sửa tay, số vòng.
5. **Trade-off RQ2:** đặt Δ F1 cạnh chi phí (thời gian, số câu hỏi, intervention rate). Không kết luận "worth it" chỉ dựa vào F1.

Kiểm định thống kê gợi ý: Wilcoxon signed-rank trên cặp (baseline_f1, gate_f1) theo requirement, báo cáo kèm effect size; n nhỏ nên ưu tiên khoảng tin cậy bootstrap hơn p-value đơn lẻ.

## 9. Chống contamination

- Sau khi main bắt đầu: không chỉnh prompt, rule, generator, normalization, metric dựa trên kết quả.
- Không sửa tay file trong `experiments/main/<run-id>`; runner không ghi đè file đã có, web server không ghi đè session đã có.
- Kết quả phải tái tạo được từ code + `manifest.json` + `llm-calls.jsonl` + `sessions/`.
- Không báo cáo kết quả chạy bằng `mock` hoặc `SCRIPTED` stakeholder như kết quả thực nghiệm.
- Báo cáo mọi call có `servedModel ≠ model` (fallback) và mọi `failures` trong `summary.json`.

## 10. Hạn chế đã biết

- Generator thay thế, không phải implementation gốc (mục 5).
- Gate và generator dùng cùng một LLM; Gate có thể "viết lại theo cách generator thích". Giảm thiểu: rewrite chỉ dùng câu trả lời đã xác nhận, con người confirm, reference UML do người làm.
- Người tham gia đóng vai stakeholder dựa trên tài liệu, không phải stakeholder thật của hệ thống.
- PURE chủ yếu là câu năng lực ("shall be able to"); USE_CASE chiếm đa số. Potential inconsistency được bổ sung bằng cặp ghim (mục 3).
- LLM không tất định (không đặt được temperature); kết quả là một lần chạy, có lưu toàn bộ output.
- Matching tên chính xác sau normalization: từ đồng nghĩa ("dial" và "call") bị tính sai. Áp dụng như nhau cho hai condition.

## 11. Lịch sử thay đổi protocol

| Ngày | Version | Thay đổi |
|---|---|---|
| 2026-10-13 | v0.1-draft | Bản đầu: thiết kế, cấu hình, quyết định M5.1, quy ước đo, quy trình |
