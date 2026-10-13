import { test } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_LOG_DISABLED = "1";
const { prf, compareModels, macro } = await import("../src/evaluation/metrics.ts");
const { detectionReport, cohensKappa } = await import("../src/evaluation/gateMetrics.ts");
const { normalizeName, normalizeModel } = await import("../src/uml/normalize.ts");
const { LlmUmlGenerator, restrictToDiagram } = await import("../src/uml/UmlGeneratorAdapter.ts");
const { MockProvider } = await import("../src/llm/mockProvider.ts");
const { EMPTY_UML } = await import("../src/types/uml.ts");

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("precision / recall / F1 formulas and edge cases", () => {
  const r = prf({ tp: 2, fp: 1, fn: 2 });
  close(r.precision, 2 / 3);
  close(r.recall, 0.5);
  close(r.f1, (2 * (2 / 3) * 0.5) / (2 / 3 + 0.5));
  assert.deepEqual(prf({ tp: 0, fp: 0, fn: 0 }), { precision: 1, recall: 1, f1: 1 });
  assert.deepEqual(prf({ tp: 0, fp: 0, fn: 3 }), { precision: 0, recall: 0, f1: 0 });
  assert.deepEqual(prf({ tp: 0, fp: 2, fn: 0 }), { precision: 0, recall: 0, f1: 0 });
});

test("name normalization", () => {
  assert.equal(normalizeName("AuditTrail"), "audit trail");
  assert.equal(normalizeName("audit_trails"), "audit trail");
  assert.equal(normalizeName("The Categories"), "category");
  assert.equal(normalizeName("Status"), "status");
  assert.equal(normalizeName("Address"), "address");
});

test("model comparison scores only the fields of the diagram type", () => {
  const gen = { ...EMPTY_UML, actors: ["Driver"], useCases: ["Adjust contrast", "Call"], classes: ["Display"] };
  const ref = { ...EMPTY_UML, actors: ["driver"], useCases: ["adjust contrast"] };
  const s = compareModels(gen, ref, "USE_CASE");
  assert.deepEqual([s.tp, s.fp, s.fn], [2, 1, 0], "classes are ignored for USE_CASE");
  close(s.f1, 0.8);
  const seq = compareModels({ ...EMPTY_UML, messages: [{ from: "Driver", to: "Radio", name: "dial" }] }, { ...EMPTY_UML, messages: [{ from: "driver", to: "radio", name: "dial" }] }, "SEQUENCE");
  assert.equal(seq.f1, 1);
});

test("macro average", () => {
  const m = macro([prf({ tp: 1, fp: 0, fn: 0 }), prf({ tp: 0, fp: 1, fn: 1 })]);
  close(m.f1, 0.5);
});

test("restrictToDiagram clears foreign fields; normalizeModel dedupes", () => {
  const m = restrictToDiagram({ ...EMPTY_UML, actors: ["a"], classes: ["c"], messages: [{ from: "a", to: "c", name: "m" }] }, "CLASS");
  assert.deepEqual(m.actors, []);
  assert.deepEqual(m.messages, []);
  assert.deepEqual(normalizeModel({ ...EMPTY_UML, classes: ["Unit", "units", "UNIT"] }).classes, ["unit"]);
});

test("generator id identifies provider, model, effort and prompt version", async () => {
  const g = new LlmUmlGenerator(new MockProvider());
  assert.match(g.id, /^llm-uml:mock:mock-heuristic:n\/a:uml-v0\.1$/);
  const out = await g.generate("The driver shall be able to adjust the contrast of the display.", "USE_CASE", "S1");
  assert.deepEqual(out.actors, ["driver"]);
});

test("gate detection report", () => {
  const rep = detectionReport([
    { requirementId: "1", gold: "CLEAR", predicted: "CLEAR" },
    { requirementId: "2", gold: "CLEAR", predicted: "AMBIGUOUS" },
    { requirementId: "3", gold: "AMBIGUOUS", predicted: "AMBIGUOUS" },
    { requirementId: "4", gold: "INCOMPLETE_FOR_TARGET", predicted: "CLEAR" },
  ]);
  assert.deepEqual([rep.tp, rep.fp, rep.fn, rep.tn], [1, 1, 1, 1]);
  close(rep.falsePositiveRateOnClear, 0.5);
  close(rep.falseNegativeRateOnProblematic, 0.5);
  close(rep.exactLabelAccuracy, 0.5);
  assert.equal(rep.perLabel.AMBIGUOUS.support, 1);
});

test("Cohen's kappa", () => {
  assert.equal(cohensKappa(["CLEAR", "AMBIGUOUS"], ["CLEAR", "AMBIGUOUS"]), 1);
  close(cohensKappa(["CLEAR", "CLEAR", "AMBIGUOUS", "AMBIGUOUS"], ["CLEAR", "AMBIGUOUS", "CLEAR", "AMBIGUOUS"]), 0);
});
