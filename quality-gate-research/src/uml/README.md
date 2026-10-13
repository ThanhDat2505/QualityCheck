# src/uml — Thành viên 5

- `UmlGeneratorAdapter.ts`: `LlmUmlGenerator`, generator **cố định** dùng cho cả baseline và treatment (quyết định M5.1 trong `docs/experiment-protocol.md`). `id` = provider:model:effort:`UML_PROMPT_VERSION`; đổi bất kỳ phần nào là generator khác.
- `normalize.ts`: chuẩn hóa tên và model (`NORMALIZATION_VERSION`).

Thay generator khác (ví dụ implementation gốc của paper): implement interface `UmlGenerator` trong `src/types/uml.ts` và chạy lại cả hai condition trong run mới.
