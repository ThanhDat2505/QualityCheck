# src/llm — Thành viên 3

Chỉ `LlmProvider.completeJson()` được gọi API. Chọn provider bằng `LLM_PROVIDER` (`anthropic` mặc định, `mock` cho test offline).

| File | Việc |
|---|---|
| `provider.ts` | interface, `LlmError` (invalid_json, refusal, truncated, api, network), log mỗi call, parse + validate, repair instruction |
| `anthropicProvider.ts` | Claude qua `@anthropic-ai/sdk`: model `claude-opus-5-5`, effort `medium`, structured output JSON schema, `fallbacks: "default"`, retry 1 lần khi sai schema |
| `mockProvider.ts` | heuristic deterministic; **không** dùng cho kết quả thực nghiệm |
| `schemas.ts` | schema Zod cho analysis, rewrite, UML |
| `prompts.ts` | prompt có `PROMPT_VERSION`; đổi text phải tăng version |
| `analyzeRequirement.ts` | ambiguity + incompleteness theo diagram (M3.3, M3.4) |
| `analyzeConsistency.ts` | potential inconsistency với related requirements (M3.5) |
| `generateClarification.ts` | gộp và đánh số câu hỏi, không gọi LLM |
| `rewriteRequirement.ts` | viết lại chỉ bằng câu trả lời đã xác nhận (M3.6) |
| `recheckRequirement.ts` | chạy lại Gate trên text đã viết lại (M3.7) |

Log: `experiments/logs/llm-calls.jsonl` (model, servedModel, effort, task, prompt version, requirement id, latency, attempts, success, token). Không có API key trong log.
