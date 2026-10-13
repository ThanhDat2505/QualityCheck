# src/gate — Thành viên 2 + 3

- `validateInput.ts`: từ chối text rỗng, diagram sai, thiếu id, related requirement sai định dạng (M2.6).
- `decisionEngine.ts`: LLM quyết định; rule hint chỉ đính kèm, không tự chặn. LLM trả CLEAR mà vẫn có issue → NEEDS_CLARIFICATION (M2.5).
- `qualityGate.ts`: validate → rules → LLM (quality + consistency, song song) → decision.
- `clarificationSession.ts`: câu hỏi → trả lời → rewrite → recheck, tối đa `MAX_CLARIFICATION_ROUNDS = 2`, rồi người confirm/edit. Dùng cho chạy theo kịch bản; web UI có luồng tương tác tương đương trong `src/web/server.ts`.
