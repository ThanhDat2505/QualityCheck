# src/rules — Thành viên 2

Rule deterministic, chạy không cần LLM. Mỗi rule trả `RuleHint` (ruleId, issueType, span, message), **không** kết luận requirement sai và **không** viết lại câu.

| Rule | File | Bắt |
|---|---|---|
| AMB-VAGUE-001 | `vagueTerms.ts` | từ định tính: quickly, fast, adequate, easy, high, low… |
| AMB-VAGUE-002 | `vagueTerms.ts` | maximum/minimum không kèm giá trị |
| AMB-PRON-001 | `pronounRules.ts` | it, this, these, those, they, them; "that" khi đứng đầu mệnh đề |
| AMB-WEAK-001 | `weakPhrases.ts` | if necessary, as needed, etc., such as, e.g., whenever possible… |
| AMB-PLACEHOLDER-001 | `weakPhrases.ts` | `<xx>`, `[SYSTEM NAME]`, `xxx` |
| INC-REF-001 | `weakPhrases.ts` | "shown in table 14-4", "as specified in Appendix B"… |

Thêm rule: tạo một `Rule` (id, description, example dạng `câu -> span 'x'`, message, findSpans), thêm vào `RULES` trong `ruleChecker.ts`, tăng `RULES_VERSION`. Test `rules.test.ts` tự kiểm tra ví dụ của mọi rule.
