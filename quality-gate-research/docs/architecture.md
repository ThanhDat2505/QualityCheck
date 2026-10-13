# Architecture

> Version v0.1 · cập nhật 2026-10-13 · tương ứng `CONTRACT_VERSION = "v0.1"`

## 1. Luồng tổng thể

```
requirements.csv ──► Rule Checker ──► rule hints ─┐
        │                                         ▼
        │                              LLM Quality Checker (ambiguity + incompleteness)
        │                              LLM Consistency Checker (chỉ khi có related requirements)
        │                                         ▼
        │                                  Decision Engine ──► GateResult (CLEAR | NEEDS_CLARIFICATION)
        │                                         │
        │                     NEEDS_CLARIFICATION ▼
        │                           Clarification questions ──► stakeholder trả lời (Web UI)
        │                                         ▼
        │                           Rewrite (chỉ dùng câu trả lời đã xác nhận) ──► Recheck (tối đa 2 vòng)
        │                                         ▼
        │                           Human Confirm / Edit ──► sessions/<id>.json
        ▼                                         ▼
  Baseline: text gốc ──► Fixed UML Generator ◄── Treatment: text đã xác nhận
                                │
                                ▼
                      NormalizedUmlModel ──► metrics vs reference ──► results.csv, summary.json
```

## 2. Module và người phụ trách

| Thư mục | Thành viên | Nội dung chính |
|---|---|---|
| `src/types/` | 2 | Contract dùng chung: `qualityGate.ts` (RequirementInput, RuleHint, QualityIssue, GateResult, GoldLabel), `uml.ts` (NormalizedUmlModel, UmlGenerator, SCORED_FIELDS) |
| `src/rules/` | 2 | Rule deterministic: vague terms, limit không có giá trị, pronoun, escape clause, placeholder, tham chiếu ngoài. Chỉ trả hint |
| `src/gate/` | 2 + 3 | `validateInput`, `decisionEngine`, `qualityGate` (điều phối), `clarificationSession` (vòng làm rõ, tối đa 2) |
| `src/llm/` | 3 | Provider wrapper duy nhất (`provider.ts`, `anthropicProvider.ts`, `mockProvider.ts`), schema JSON, prompt có version, analyze / consistency / clarification / rewrite / recheck |
| `src/web/` | 4 | HTTP server + UI một trang, state machine, event log, export record |
| `src/uml/` | 5 | `UmlGeneratorAdapter.ts` (generator cố định), `normalize.ts` |
| `src/evaluation/` | 5 | Đọc dataset, runner baseline/treatment, metrics UML, metrics Gate detection, Cohen's kappa |
| `scripts/` | 1, 5 | `build-requirements.ts` (dataset), `experiment.ts` (CLI thực nghiệm) |

## 3. Contract chính

Định nghĩa đầy đủ trong `src/types/qualityGate.ts` và `src/types/uml.ts`. Đổi một field là breaking change: tăng `CONTRACT_VERSION` và báo các thành viên khác.

- `RequirementInput { id, text, targetDiagram, context?, relatedRequirements? }`. `context` = câu trước/sau trong tài liệu nguồn; `relatedRequirements` = các requirement trong `related_requirement_ids`, đã kèm text.
- `GateResult { requirementId, status, issues[], ruleHints[] }`. `gateResultToLabel()` chuyển sang không gian nhãn của annotation để so với `gold.csv`.
- `NormalizedUmlModel { actors, classes, useCases, operations, relationships[], messages[] }`. `SCORED_FIELDS` quy định field nào được chấm theo từng diagram.

## 4. LLM

- **Một điểm gọi API duy nhất**: `LlmProvider.completeJson()`. Không module nào khác gọi API.
- **Provider**: `anthropic` (Claude, SDK `@anthropic-ai/sdk`, mặc định model `claude-opus-5-5`, effort `medium`) hoặc `mock` (heuristic deterministic, chỉ để test và chạy offline). Chọn bằng `LLM_PROVIDER` hoặc `--provider`.
- **Structured output**: `output_config.format = json_schema` sinh từ schema Zod; kết quả luôn được validate lại. Sai schema thì retry **một lần** với repair instruction; vẫn sai thì `LlmError("invalid_json")`. Không bao giờ tự tạo kết quả hợp lệ trong code.
- **Lỗi có kiểm soát**: `LlmError.kind` ∈ `invalid_json | refusal | truncated | api | network`. Runner ghi `{error}` vào file của requirement đó; web server trả 502 và UI chuyển sang state `ERROR`.
- **Tái lập**: model `claude-opus-5-5` không nhận `temperature`, nên tính tái lập dựa vào model id cố định, effort cố định, `PROMPT_VERSION` / `UML_PROMPT_VERSION`, và việc lưu mọi output (không bao giờ chạy lại để thay). Mỗi call ghi một dòng vào `experiments/logs/llm-calls.jsonl`: provider, model, `servedModel`, effort, task, prompt version, requirement id, latency, attempts, success, token. Không ghi API key.
- **Fallback**: request bật `fallbacks: "default"` (server-side) để request bị bộ phân loại an toàn từ chối được model khác trả lời thay. Khi đó `servedModel ≠ model` trong log; protocol yêu cầu báo cáo các call này.

## 5. Web UI

`npm run web -- --input <csv> --run <dir>` mở `http://localhost:5173`. State machine: `UNANALYZED → ANALYZING → CLEAR | NEEDS_CLARIFICATION → WAITING_FOR_ANSWER → REWRITING → WAITING_FOR_CONFIRMATION → CONFIRMED → SENT_TO_UML`, và `ERROR`.

- Server giữ trạng thái phiên (gate, câu hỏi, câu trả lời, rewrite) và **tự ghi** `sessions/<id>.json`. Trình duyệt chỉ gửi câu trả lời, quyết định CONFIRM/EDIT và text cuối.
- `CONFIRM` bắt buộc giữ nguyên text đề xuất; muốn đổi phải `EDIT`. Không có tự động confirm.
- Không gửi gold label hay cột `expected_*` xuống trình duyệt. Participant id chỉ gồm chữ/số/`-`/`_`.
- Không ghi đè: requirement đã review trong một run thì không review lại được (409).
- Event (`analysis_started` … `manual_edit_completed`) ghi vào `<run>/events.jsonl`; thời gian làm rõ, tổng thời gian review và thời gian sửa tay được tính từ event (`src/web/timing.ts`).

## 6. Thư mục thực nghiệm

```
experiments/<phase>/<run-id>/
  manifest.json      phiên bản mọi thành phần, dataset, provider/model/effort, generator id, git commit
  gate/<id>.json     GateResult hoặc {error}
  sessions/<id>.json export record (UI: HUMAN; smoke: SCRIPTED)
  events.jsonl       event UI
  baseline/<id>.json UML từ text gốc
  treatment/<id>.json UML từ text đã xác nhận
  results.csv        bảng so sánh (plan M5.8)
  summary.json       kết quả tổng hợp (plan mục 12–13)
```

Một thư mục run gắn với **một** cấu hình: `initRun` từ chối chạy tiếp nếu phiên bản rule/prompt/model/generator khác với `manifest.json`. Mỗi bước chỉ điền các file còn thiếu, không ghi đè.

## 7. Lệnh

| Lệnh | Việc |
|---|---|
| `npm run check` | type-check (strict) + toàn bộ unit/integration test |
| `npm run data:build` | dựng lại `data/sampled/requirements.csv` từ `data/raw` |
| `npm run smoke:mock` | smoke end-to-end 10 fixture, không cần mạng |
| `npm run smoke` | smoke với Claude (cần `ANTHROPIC_API_KEY`) |
| `npm run experiment -- <gate\|baseline\|sessions\|treatment\|score> --input <csv> --run <dir>` | từng bước thực nghiệm |
| `npm run web -- --input <csv> --run <dir>` | UI review cho người tham gia |
