import { test } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_LOG_DISABLED = "1";
const { decide } = await import("../src/gate/decisionEngine.ts");
const { validateRequirementInput, InvalidRequirementError } = await import("../src/gate/validateInput.ts");
const { runQualityGate } = await import("../src/gate/qualityGate.ts");
const { runClarificationSession } = await import("../src/gate/clarificationSession.ts");
const { generateClarification } = await import("../src/llm/generateClarification.ts");
const { MockProvider } = await import("../src/llm/mockProvider.ts");
const { gateResultToLabel } = await import("../src/types/qualityGate.ts");

const mock = new MockProvider();

test("validation rejects empty text, bad diagram, missing id, malformed related requirements", () => {
  const bad = [
    { id: "R1", text: " ", targetDiagram: "CLASS" },
    { id: "R1", text: "x", targetDiagram: "ACTIVITY" },
    { text: "x", targetDiagram: "CLASS" },
    { id: "R1", text: "x", targetDiagram: "CLASS", relatedRequirements: [{ id: "", text: "y" }] },
    { id: "R1", text: "x", targetDiagram: "CLASS", relatedRequirements: [{ id: "R1", text: "y" }] },
  ];
  for (const b of bad) assert.throws(() => validateRequirementInput(b), InvalidRequirementError);
  assert.doesNotThrow(() => validateRequirementInput({ id: "R1", text: "x", targetDiagram: "SEQUENCE", relatedRequirements: [{ id: "R2", text: "y" }] }));
});

test("decision: LLM decides; rule hints alone never block", () => {
  const hints = [{ ruleId: "AMB-PRON-001", issueType: "AMBIGUITY" as const, span: "it", message: "m" }];
  assert.equal(decide("R1", hints, { status: "CLEAR", issues: [] }).status, "CLEAR");
  const issue = { type: "AMBIGUITY" as const, span: "quickly", reason: "r", question: "q" };
  const r = decide("R1", [], { status: "CLEAR", issues: [issue, { ...issue }] });
  assert.equal(r.status, "NEEDS_CLARIFICATION", "CLEAR with issues is inconsistent output");
  assert.equal(r.issues.length, 1, "duplicates removed");
});

test("gate result maps to annotation labels", () => {
  const i = (type: any) => ({ type, reason: "r", question: "q" });
  const res = (issues: any[]) => ({ requirementId: "R", status: issues.length ? "NEEDS_CLARIFICATION" : "CLEAR", issues, ruleHints: [] }) as any;
  assert.equal(gateResultToLabel(res([])), "CLEAR");
  assert.equal(gateResultToLabel(res([i("AMBIGUITY"), i("AMBIGUITY")])), "AMBIGUOUS");
  assert.equal(gateResultToLabel(res([i("INCOMPLETENESS")])), "INCOMPLETE_FOR_TARGET");
  assert.equal(gateResultToLabel(res([i("POTENTIAL_INCONSISTENCY")])), "POTENTIAL_INCONSISTENCY");
  assert.equal(gateResultToLabel(res([i("AMBIGUITY"), i("INCOMPLETENESS")])), "MULTIPLE_ISSUES");
});

test("clarification questions are merged and numbered without new content", () => {
  const qs = generateClarification([
    { type: "AMBIGUITY", span: "it", reason: "r", question: "What is 'it'?" },
    { type: "INCOMPLETENESS", reason: "r", question: "what is 'it'? " },
    { type: "AMBIGUITY", span: "quickly", reason: "r", question: "How fast?" },
  ]);
  assert.deepEqual(qs.map((q) => q.id), ["Q1", "Q2"]);
  assert.deepEqual(qs[0].issueTypes, ["AMBIGUITY", "INCOMPLETENESS"]);
});

test("gate end to end with the mock provider (no network)", async () => {
  const clear = await runQualityGate(mock, { id: "S1", text: "The driver shall be able to adjust the contrast of the display.", targetDiagram: "USE_CASE" });
  assert.equal(clear.status, "CLEAR");
  const vague = await runQualityGate(mock, { id: "S2", text: "The system should process it quickly.", targetDiagram: "USE_CASE" });
  assert.equal(vague.status, "NEEDS_CLARIFICATION");
  assert.ok(vague.ruleHints.some((h) => h.span === "quickly"));
});

test("clarification session: rewrite, recheck, max 2 rounds, human edit recorded", async () => {
  let rounds = 0;
  const record = await runClarificationSession(
    mock,
    { id: "S2", text: "The system should process it quickly.", targetDiagram: "USE_CASE" },
    {
      answer: async (questions) => {
        rounds++;
        return questions.map((q) => ({ id: q.id, question: q.question, answer: q.span === "quickly" ? "within 2 seconds" : q.span === "it" ? "the payment request" : "" }));
      },
      confirm: async (_o, rewritten) => ({ decision: "EDIT", finalText: `${rewritten} (edited)` }),
    },
  );
  assert.ok(rounds >= 1 && rounds <= 2);
  assert.match(record.clarifiedText, /within 2 seconds/);
  assert.match(record.clarifiedText, /payment request/);
  assert.equal(record.humanEdited, true);
  assert.ok(record.questionCount >= 2);
});

test("stakeholder without answers stops the session and leaves issues unresolved", async () => {
  const record = await runClarificationSession(mock, { id: "S3", text: "Reports shall be generated as needed.", targetDiagram: "USE_CASE" }, {
    answer: async (qs) => qs.map((q) => ({ id: q.id, question: q.question, answer: "" })),
    confirm: async (o) => ({ decision: "CONFIRM", finalText: o }),
  });
  assert.equal(record.rounds.length, 0);
  assert.ok(record.unresolvedIssues.length > 0);
  assert.equal(record.finalText, record.originalText);
});
