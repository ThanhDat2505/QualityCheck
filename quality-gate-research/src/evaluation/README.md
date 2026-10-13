# src/evaluation — Thành viên 5

- `dataset.ts`: đọc CSV (requirements, smoke, pilot, gold).
- `runner.ts`: các bước gate / baseline / sessions (scripted) / treatment / score; manifest; không ghi đè; `results.csv` (M5.8) và `summary.json` (mục 12–13).
- `metrics.ts`: P/R/F1 (quy ước biên trong protocol), so sánh model theo field của diagram, macro average.
- `gateMetrics.ts`: Gate detection so với gold, FP/FN rate, theo nhãn; Cohen's kappa.
- `scriptedStakeholder.ts`: trả lời theo fixture, **chỉ** cho smoke/pilot dry run.

CLI: `node scripts/experiment.ts <gate|baseline|sessions|treatment|score|smoke> --input <csv> --run <dir>`.
