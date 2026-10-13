// Human-in-the-loop review UI (plan member 4).
//   node src/web/server.ts --input data/sampled/requirements.csv --run experiments/pilot/<run> [--port 5173] [--provider mock]
//
// The server owns the session state (Gate result, questions, answers, rewrites) and writes the export
// record itself, so the browser cannot inject results. Experiment mode: the API never sends gold labels
// or expected answers (any column named label / expected_* is dropped), participants are pseudonymous ids,
// and an existing export record is never overwritten.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { MAX_CLARIFICATION_ROUNDS } from "../gate/clarificationSession.ts";
import { runQualityGate } from "../gate/qualityGate.ts";
import { InvalidRequirementError } from "../gate/validateInput.ts";
import { loadDataset, type DatasetRow } from "../evaluation/dataset.ts";
import { initRun, type ExportRecord } from "../evaluation/runner.ts";
import { generateClarification, type ClarificationQuestion } from "../llm/generateClarification.ts";
import { createProvider } from "../llm/index.ts";
import type { ConfirmedAnswer } from "../llm/prompts.ts";
import { LlmError } from "../llm/provider.ts";
import { recheckRequirement } from "../llm/recheckRequirement.ts";
import { rewriteRequirement } from "../llm/rewriteRequirement.ts";
import type { GateResult, QualityIssue } from "../types/qualityGate.ts";
import { LlmUmlGenerator } from "../uml/UmlGeneratorAdapter.ts";
import { computeTimings, type UiEvent } from "./timing.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    input: { type: "string", default: "data/sampled/requirements.csv" },
    run: { type: "string" },
    port: { type: "string", default: "5173" },
    provider: { type: "string" },
  },
});
if (!values.run) {
  console.error("usage: node src/web/server.ts --input <csv> --run <experiment dir> [--port 5173] [--provider anthropic|mock]");
  process.exit(2);
}
const RUN = values.run;
const rows = loadDataset(values.input!);
const byId = new Map(rows.map((r) => [r.input.id, r]));
const provider = createProvider(values.provider);
initRun(RUN, {
  dataset: values.input!,
  datasetVersion: "v0.1",
  provider: provider.name,
  model: provider.model,
  effort: provider.effort,
  umlGeneratorId: new LlmUmlGenerator(provider).id,
  note: "web UI review sessions",
});
mkdirSync(join(RUN, "sessions"), { recursive: true });
const EVENTS = join(RUN, "events.jsonl");

interface Session {
  key: string;
  participantId: string;
  row: DatasetRow;
  gate: GateResult;
  round: number;
  text: string;
  questions: ClarificationQuestion[];
  issues: QualityIssue[];
  answers: ConfirmedAnswer[];
  rounds: ExportRecord["rounds"];
  questionCount: number;
}
const sessions = new Map<string, Session>();

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : String(body));
}

async function body(req: IncomingMessage): Promise<any> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

function logEvent(e: UiEvent) {
  appendFileSync(EVENTS, JSON.stringify(e) + "\n", "utf8");
}

function exportPath(id: string) {
  return join(RUN, "sessions", `${id}.json`);
}

// Public view of a requirement: never includes gold or expected columns.
function publicRow(r: DatasetRow) {
  return { id: r.input.id, text: r.input.text, targetDiagram: r.input.targetDiagram, context: r.input.context ?? [], related: r.input.relatedRequirements ?? [], reviewed: existsSync(exportPath(r.input.id)) };
}

function nextQuestions(s: Session, issues: QualityIssue[]): ClarificationQuestion[] {
  return generateClarification(issues).map((q) => ({ ...q, id: `R${s.round}${q.id}` }));
}

const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
  "GET /": async (_q, res) => send(res, 200, readFileSync(join(HERE, "public", "index.html"), "utf8"), "text/html"),
  "GET /app.js": async (_q, res) => send(res, 200, readFileSync(join(HERE, "public", "app.js"), "utf8"), "text/javascript"),
  "GET /api/config": async (_q, res) => send(res, 200, { provider: provider.name, model: provider.model, maxRounds: MAX_CLARIFICATION_ROUNDS, run: RUN }),
  "GET /api/requirements": async (_q, res) => send(res, 200, rows.map(publicRow)),

  "POST /api/session/start": async (req, res) => {
    const { participantId, requirementId, t } = await body(req);
    const row = byId.get(requirementId);
    if (!row) return send(res, 404, { error: "unknown requirement" });
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(participantId ?? "")) return send(res, 400, { error: "participant id: 1-32 letters, digits, - or _" });
    if (existsSync(exportPath(requirementId))) return send(res, 409, { error: "already reviewed in this run" });
    const key = randomUUID();
    logEvent({ sessionKey: key, participantId, requirementId, event: "analysis_started", t: t ?? Date.now() });
    const gate = await runQualityGate(provider, row.input);
    const s: Session = { key, participantId, row, gate, round: 1, text: row.input.text, questions: [], issues: gate.issues, answers: [], rounds: [], questionCount: 0 };
    s.questions = gate.status === "CLEAR" ? [] : nextQuestions(s, gate.issues);
    s.questionCount += s.questions.length;
    sessions.set(key, s);
    logEvent({ sessionKey: key, participantId, requirementId, event: "analysis_completed", t: Date.now() });
    send(res, 200, { sessionKey: key, gate, questions: s.questions, round: s.round, maxRounds: MAX_CLARIFICATION_ROUNDS });
  },

  "POST /api/session/answer": async (req, res) => {
    const { sessionKey, answers } = await body(req);
    const s = sessions.get(sessionKey);
    if (!s) return send(res, 404, { error: "unknown session" });
    const given: ConfirmedAnswer[] = s.questions.map((q) => ({ id: q.id, question: q.question, answer: String((answers ?? {})[q.id] ?? "").trim() }));
    s.answers.push(...given);
    const rewrite = await rewriteRequirement(provider, s.row.input.id, s.text, s.row.input.targetDiagram, given);
    s.text = rewrite.rewrittenText;
    const recheck = await recheckRequirement(provider, s.row.input, s.text);
    s.rounds.push({ questions: s.questions, answers: given, rewrittenText: s.text, recheck });
    s.issues = recheck.issues;
    const canAskAgain = s.round < MAX_CLARIFICATION_ROUNDS && recheck.issues.length > 0;
    send(res, 200, { rewrittenText: s.text, recheck, canAskAgain, round: s.round });
  },

  "POST /api/session/ask-again": async (req, res) => {
    const { sessionKey } = await body(req);
    const s = sessions.get(sessionKey);
    if (!s) return send(res, 404, { error: "unknown session" });
    if (s.round >= MAX_CLARIFICATION_ROUNDS || s.issues.length === 0) return send(res, 400, { error: "no further clarification round allowed" });
    s.round++;
    s.questions = nextQuestions(s, s.issues);
    s.questionCount += s.questions.length;
    send(res, 200, { questions: s.questions, round: s.round });
  },

  "POST /api/session/complete": async (req, res) => {
    const { sessionKey, decision, finalText } = await body(req);
    const s = sessions.get(sessionKey);
    if (!s) return send(res, 404, { error: "unknown session" });
    if (!["CONFIRM", "EDIT"].includes(decision) || typeof finalText !== "string" || !finalText.trim()) return send(res, 400, { error: "decision CONFIRM|EDIT and a non-empty finalText are required" });
    if (decision === "CONFIRM" && finalText !== s.text) return send(res, 400, { error: "CONFIRM must keep the proposed text; use EDIT to change it" });
    const path = exportPath(s.row.input.id);
    if (existsSync(path)) return send(res, 409, { error: "already reviewed in this run" });
    const timings = computeTimings(readEvents(sessionKey));
    const record: ExportRecord = {
      requirementId: s.row.input.id,
      originalText: s.row.input.text,
      gateStatus: s.gate.status,
      issues: s.gate.issues,
      rounds: s.rounds,
      answers: s.answers,
      clarifiedText: s.text,
      finalText: finalText.trim(),
      humanEdited: decision === "EDIT" && finalText.trim() !== s.text,
      questionCount: s.questionCount,
      unresolvedIssues: s.issues,
      participantId: s.participantId,
      stakeholder: "HUMAN",
      clarificationTimeMs: timings.clarificationTimeMs,
      totalReviewTimeMs: timings.totalReviewTimeMs,
      manualEditTimeMs: timings.manualEditTimeMs,
      clarificationRounds: s.rounds.length,
    };
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    sessions.delete(sessionKey);
    send(res, 200, record);
  },

  "POST /api/events": async (req, res) => {
    const { sessionKey, event, t } = await body(req);
    const s = sessions.get(sessionKey);
    if (!s) return send(res, 404, { error: "unknown session" });
    logEvent({ sessionKey, participantId: s.participantId, requirementId: s.row.input.id, event, t: typeof t === "number" ? t : Date.now() });
    send(res, 200, { ok: true });
  },
};

function readEvents(sessionKey: string): UiEvent[] {
  if (!existsSync(EVENTS)) return [];
  return readFileSync(EVENTS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as UiEvent)
    .filter((e) => e.sessionKey === sessionKey);
}

createServer(async (req, res) => {
  const route = routes[`${req.method} ${(req.url ?? "/").split("?")[0]}`];
  if (!route) return send(res, 404, { error: "not found" });
  try {
    await route(req, res);
  } catch (e) {
    // API/network failures become an ERROR state in the UI, never a crash of the server.
    if (e instanceof LlmError) send(res, 502, { error: e.message, kind: e.kind });
    else if (e instanceof InvalidRequirementError) send(res, 400, { error: e.message });
    else send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(Number(values.port), () => {
  console.log(`Quality Gate review UI: http://localhost:${values.port}  (run: ${RUN}, provider: ${provider.name}/${provider.model})`);
  if (provider.name === "mock") console.warn("WARNING: mock provider - sessions are for UI testing only.");
});
