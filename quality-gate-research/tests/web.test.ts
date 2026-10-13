import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeTimings } from "../src/web/timing.ts";

// UX QA (plan M4.6) through the real HTTP API with the mock provider.
const RUN = mkdtempSync(join(tmpdir(), "qg-web-"));
const PORT = 5600 + (process.pid % 300);
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess;

async function post(path: string, body: unknown) {
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as any };
}

before(async () => {
  server = spawn(process.execPath, ["src/web/server.ts", "--input", "data/fixtures/smoke.csv", "--run", RUN, "--port", String(PORT), "--provider", "mock"], {
    env: { ...process.env, LLM_LOG_DISABLED: "1" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/api/config`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
});

after(() => {
  server.kill();
  rmSync(RUN, { recursive: true, force: true });
});

test("experiment mode: no gold or expected answers are sent to the browser", async () => {
  const rows = (await (await fetch(`${BASE}/api/requirements`)).json()) as any[];
  assert.equal(rows.length, 10);
  const payload = JSON.stringify(rows);
  for (const forbidden of ["expected_label", "expected_issue_span", "expected_reason", "POTENTIAL_INCONSISTENCY", "INCOMPLETE_FOR_TARGET"]) assert.ok(!payload.includes(forbidden), forbidden);
});

test("clear requirement: no questions, explicit send, export record written", async () => {
  const start = await post("/api/session/start", { participantId: "P01", requirementId: "S001" });
  assert.equal(start.data.gate.status, "CLEAR");
  assert.deepEqual(start.data.questions, []);
  const done = await post("/api/session/complete", { sessionKey: start.data.sessionKey, decision: "CONFIRM", finalText: "The driver shall be able to adjust the contrast of the display. (M)" });
  assert.equal(done.status, 200);
  assert.equal(done.data.stakeholder, "HUMAN");
  assert.ok(existsSync(join(RUN, "sessions", "S001.json")));
  const again = await post("/api/session/start", { participantId: "P01", requirementId: "S001" });
  assert.equal(again.status, 409, "a reviewed requirement cannot be redone or overwritten");
});

test("issues -> answers -> rewrite -> human edit; timing derived from events", async () => {
  const start = await post("/api/session/start", { participantId: "P01", requirementId: "S004" });
  assert.equal(start.data.gate.status, "NEEDS_CLARIFICATION");
  assert.ok(start.data.questions.length >= 2, "multiple issues");
  const key = start.data.sessionKey;
  const t0 = Date.now();
  await post("/api/events", { sessionKey: key, event: "clarification_shown", t: t0 });
  await post("/api/events", { sessionKey: key, event: "answer_submitted", t: t0 + 3000 });
  const answers = Object.fromEntries(start.data.questions.map((q: any) => [q.id, "at most 2 seconds"]));
  const ans = await post("/api/session/answer", { sessionKey: key, answers });
  assert.match(ans.data.rewrittenText, /2 seconds/);
  const bad = await post("/api/session/complete", { sessionKey: key, decision: "CONFIRM", finalText: "something else" });
  assert.equal(bad.status, 400, "CONFIRM cannot silently change the text");
  await post("/api/events", { sessionKey: key, event: "manual_edit_started", t: t0 + 4000 });
  await post("/api/events", { sessionKey: key, event: "manual_edit_completed", t: t0 + 6000 });
  await post("/api/events", { sessionKey: key, event: "confirmed", t: t0 + 6500 });
  const done = await post("/api/session/complete", { sessionKey: key, decision: "EDIT", finalText: `${ans.data.rewrittenText} Edited.` });
  assert.equal(done.status, 200);
  assert.equal(done.data.humanEdited, true);
  assert.equal(done.data.clarificationTimeMs, 3000);
  assert.equal(done.data.manualEditTimeMs, 2000);
  assert.equal(done.data.clarificationRounds, 1);
  const saved = JSON.parse(readFileSync(join(RUN, "sessions", "S004.json"), "utf8"));
  assert.equal(saved.participantId, "P01");
});

test("second clarification round is allowed once, then refused", async () => {
  const start = await post("/api/session/start", { participantId: "P02", requirementId: "S006" });
  const key = start.data.sessionKey;
  const blank = Object.fromEntries(start.data.questions.map((q: any) => [q.id, ""]));
  const r1 = await post("/api/session/answer", { sessionKey: key, answers: blank });
  assert.equal(r1.data.canAskAgain, true);
  const again = await post("/api/session/ask-again", { sessionKey: key });
  assert.equal(again.data.round, 2);
  await post("/api/session/answer", { sessionKey: key, answers: {} });
  const third = await post("/api/session/ask-again", { sessionKey: key });
  assert.equal(third.status, 400);
});

test("invalid participant id and unknown session are rejected without crashing", async () => {
  assert.equal((await post("/api/session/start", { participantId: "Nguyễn Văn A", requirementId: "S002" })).status, 400);
  assert.equal((await post("/api/session/answer", { sessionKey: "nope", answers: {} })).status, 404);
  assert.equal((await fetch(`${BASE}/api/config`)).status, 200, "server still up");
});

test("timing helper", () => {
  const ev = (event: string, t: number) => ({ sessionKey: "k", participantId: "p", requirementId: "r", event, t });
  const t = computeTimings([ev("analysis_started", 0), ev("clarification_shown", 10), ev("answer_submitted", 40), ev("clarification_shown", 50), ev("answer_submitted", 70), ev("confirmed", 100)]);
  assert.deepEqual(t, { clarificationTimeMs: 50, totalReviewTimeMs: 100, manualEditTimeMs: null });
});
