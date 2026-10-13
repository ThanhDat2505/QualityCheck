# quality-gate-research

Prototype và bộ thực nghiệm cho **Requirement Quality Gate (RQG)** đặt trước một pipeline cố định chuyển requirement sang UML (SWD392). Gate kiểm tra ba loại vấn đề: ambiguity, incompleteness cho diagram mục tiêu, và potential inconsistency. Sau đó Gate hỏi stakeholder để làm rõ, viết lại requirement chỉ bằng thông tin đã được xác nhận, và để con người confirm hoặc sửa trước khi sinh UML.

Không train model: hệ thống gồm rule deterministic, Claude API, human-in-the-loop và một UML generator cố định.

## Bắt đầu

Yêu cầu Node ≥ 23.6 (chạy TypeScript trực tiếp, không cần build).

```bash
npm install
npm run check          # type-check strict + 36 test
npm run smoke:mock     # chạy end-to-end 10 smoke fixture, không cần mạng
```

Chạy với Claude:

```bash
cp .env.example .env   # điền ANTHROPIC_API_KEY (hoặc dùng `ant auth login`)
node --env-file=.env scripts/experiment.ts smoke
node --env-file=.env src/web/server.ts --input data/pilot/pilot.csv --run experiments/pilot/pilot-01
```

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/types` | Contract dùng chung (plan M2.1) |
| `src/rules` | Rule deterministic, chỉ trả hint |
| `src/llm` | Provider wrapper, prompt có version, analyze / consistency / rewrite / recheck |
| `src/gate` | Validate, decision engine, điều phối Gate, vòng làm rõ |
| `src/web` | UI review cho người tham gia, log thời gian |
| `src/uml` | UML generator cố định + normalization |
| `src/evaluation` | Đọc dataset, runner baseline/treatment, metric |
| `scripts` | `build-requirements.ts` (dataset), `experiment.ts` (CLI thực nghiệm) |
| `data` | `raw` (PURE), `sampled` (tập đánh giá), `annotations`, `fixtures` (smoke), `pilot` |
| `experiments` | Mỗi run một thư mục: manifest, output từng bước, results.csv, summary.json |
| `docs` | `architecture.md`, `experiment-protocol.md`, `annotation-guide.md` |

## Tài liệu

- [docs/architecture.md](docs/architecture.md): luồng, module, contract, LLM, web UI, cấu trúc run.
- [docs/experiment-protocol.md](docs/experiment-protocol.md): RQ, thiết kế, cấu hình freeze, quyết định về UML generator, quy ước đo, quy trình pilot/main, hạn chế.
- [docs/annotation-guide.md](docs/annotation-guide.md): quy tắc gắn nhãn gold.
- [data/sampled/README.md](data/sampled/README.md) và [review-notes.md](data/sampled/review-notes.md): cách dựng dataset, các dòng cần thay trước khi freeze.

## Trạng thái (2026-10-13)

| Checkpoint (plan mục 14) | Trạng thái |
|---|---|
| A — Architecture ready | Xong: contract, cấu trúc repo, 10 smoke fixture |
| B — Modules ready | Xong: rule pass test, LLM wrapper validate JSON, UI chạy flow làm rõ, UML adapter, metric |
| C — Integrated prototype | Xong với provider mock: 10/10 smoke end-to-end, có log, không copy file tay. **Cần chạy lại với Claude** khi có API key |
| D — Pilot complete | Chưa: cần API key và người review trên `data/pilot/pilot.csv` |
| E — Main experiment ready | Chưa: cần gold labels, reference UML, freeze |
| F — Results ready | Chưa |
