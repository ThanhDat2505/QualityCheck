import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRules, RULES } from "../src/rules/ruleChecker.ts";

const ids = (text: string) => checkRules(text).map((h) => `${h.ruleId}:${h.span}`);

test("plan M2.7 case 1: vague term and pronoun", () => {
  const hints = ids("The system should process it quickly.");
  assert.ok(hints.includes("AMB-VAGUE-001:quickly"));
  assert.ok(hints.includes("AMB-PRON-001:it"));
});

test("plan M2.7 case 2: measurable requirement has no vague-term hint", () => {
  const hints = checkRules("The payment service shall process a payment request within 2 seconds.");
  assert.equal(hints.filter((h) => h.ruleId.startsWith("AMB-VAGUE")).length, 0);
});

test("every rule has id, description, example and message", () => {
  for (const r of RULES) for (const f of ["id", "description", "example", "message"] as const) assert.ok(r[f], `${r.id} ${f}`);
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
});

test("rule examples trigger their own rule", () => {
  for (const r of RULES) {
    const [sentence, expected] = r.example.split(" -> span ");
    const span = expected.replace(/^'|'$/g, "");
    assert.ok(r.findSpans(sentence).some((s) => s.toLowerCase() === span.toLowerCase()), `${r.id} example`);
  }
});

test("whole words only: 'highway' and 'fastidious' are not vague terms", () => {
  assert.deepEqual(ids("The highway map is fastidious.").filter((x) => x.startsWith("AMB-VAGUE")), []);
});

test("relative 'that' is not flagged, clause-initial 'That' is", () => {
  assert.ok(!ids("Data that is stored shall be encrypted.").some((x) => x === "AMB-PRON-001:that"));
  assert.ok(ids("The unit sends a status. That shall be logged.").includes("AMB-PRON-001:That"));
});

test("maximum without a value is flagged, with a value is not", () => {
  assert.ok(ids("There shall be a maximum number of heating units.").includes("AMB-VAGUE-002:maximum"));
  assert.ok(!ids("The radio shall weigh a maximum of 800 g.").some((x) => x.startsWith("AMB-VAGUE-002")));
});

test("placeholders and external references", () => {
  assert.ok(ids("The System must be available from <xx:00> to <xx:00>.").includes("AMB-PLACEHOLDER-001:<xx:00>"));
  assert.ok(ids("Deploy the [SYSTEM NAME] build.").includes("AMB-PLACEHOLDER-001:[SYSTEM NAME]"));
  assert.ok(ids("The procedure is shown in table 14-4.").some((x) => x.startsWith("INC-REF-001")));
});

test("rules return structured hints only and never rewrite text", () => {
  const text = "The system should be easy to use if necessary.";
  for (const h of checkRules(text)) {
    assert.deepEqual(Object.keys(h).sort(), ["issueType", "message", "ruleId", "span"]);
    assert.ok(text.toLowerCase().includes(h.span!.toLowerCase()));
  }
});
