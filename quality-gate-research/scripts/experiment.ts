// Experiment runner (plan M5.6–M5.8, I3, sections 9 and 11).
//
//   node scripts/experiment.ts <command> --input <csv> --run <dir> [options]
//
// Commands (each step only fills in missing outputs, so a run can be resumed):
//   gate       run the Quality Gate on every requirement               -> <run>/gate/
//   baseline   ORIGINAL text -> fixed UML generator                    -> <run>/baseline/
//   sessions   scripted clarification (smoke/pilot only, --answers)    -> <run>/sessions/
//   treatment  confirmed text from <run>/sessions -> same generator    -> <run>/treatment/
//   score      metrics vs. --reference [--gold <csv> --gold-column c]  -> <run>/results.csv, summary.json
//   smoke      all of the above on data/fixtures/smoke.csv with scripted answers (plan I3)
//
// Options: --provider anthropic|mock (default: LLM_PROVIDER or anthropic), --note "<text>"
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createProvider } from "../src/llm/index.ts";
import { loadDataset, loadGold } from "../src/evaluation/dataset.ts";
import { initRun, runBaselineStep, runGateStep, runScriptedSessions, runTreatmentStep, scoreRun } from "../src/evaluation/runner.ts";
import { loadAnswerFixture, scriptedStakeholder } from "../src/evaluation/scriptedStakeholder.ts";
import { LlmUmlGenerator } from "../src/uml/UmlGeneratorAdapter.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    input: { type: "string" },
    run: { type: "string" },
    provider: { type: "string" },
    answers: { type: "string" },
    reference: { type: "string" },
    gold: { type: "string" },
    "gold-column": { type: "string", default: "label" },
    "dataset-version": { type: "string", default: "v0.1" },
    note: { type: "string", default: "" },
  },
});

const command = positionals[0];
const smoke = command === "smoke";
const input = values.input ?? (smoke ? "data/fixtures/smoke.csv" : undefined);
const runDir = values.run ?? (smoke ? join("experiments", "smoke", `smoke-${values.provider ?? process.env.LLM_PROVIDER ?? "anthropic"}`) : undefined);
if (!command || !input || !runDir) {
  console.error("usage: node scripts/experiment.ts <gate|baseline|sessions|treatment|score|smoke> --input <csv> --run <dir> [options]");
  process.exit(2);
}

const rows = loadDataset(input);
const provider = createProvider(values.provider);
const generator = new LlmUmlGenerator(provider);
const manifest = initRun(runDir, {
  dataset: input,
  datasetVersion: values["dataset-version"]!,
  provider: provider.name,
  model: provider.model,
  effort: provider.effort,
  umlGeneratorId: generator.id,
  note: values.note || (smoke ? "smoke test with scripted stakeholder (not experimental data)" : ""),
});
if (provider.name === "mock") console.warn("WARNING: mock provider - results are for pipeline testing only, not experimental data.");

const report = (step: string, r: { done: number; skipped: number; failed: number }) =>
  console.log(`${step.padEnd(9)} done ${r.done}, kept existing ${r.skipped}, failed ${r.failed}`);

async function main() {
  const steps = smoke ? ["gate", "baseline", "sessions", "treatment", "score"] : [command];
  for (const step of steps) {
    if (step === "gate") report(step, await runGateStep(runDir!, rows, provider));
    else if (step === "baseline") report(step, await runBaselineStep(runDir!, rows, generator));
    else if (step === "sessions") {
      const answersPath = values.answers ?? (smoke ? "data/fixtures/smoke-answers.json" : undefined);
      if (!answersPath) throw new Error("sessions needs --answers <fixture.json>; real sessions come from the web UI export");
      const fixture = loadAnswerFixture(answersPath);
      report(step, await runScriptedSessions(runDir!, rows, provider, (row) => scriptedStakeholder(fixture[row.input.id])));
    } else if (step === "treatment") report(step, await runTreatmentStep(runDir!, rows, generator));
    else if (step === "score") {
      const referenceDir = values.reference ?? (smoke ? "data/fixtures/reference" : "data/reference");
      if (!existsSync(referenceDir)) throw new Error(`reference directory not found: ${referenceDir}`);
      const goldPath = values.gold ?? (smoke ? input : undefined);
      const goldColumn = smoke && !values.gold ? "expected_label" : values["gold-column"]!;
      const summary = scoreRun(runDir!, rows, referenceDir, goldPath ? loadGold(goldPath, goldColumn) : undefined);
      const f = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
      console.log(`score     UML F1 baseline ${f(summary.uml.overall.baseline.f1)} -> gate ${f(summary.uml.overall.gate.f1)} (n=${summary.uml.overall.n})`);
      if (summary.gateDetection) console.log(`          Gate detection P ${f(summary.gateDetection.all.precision)} R ${f(summary.gateDetection.all.recall)} F1 ${f(summary.gateDetection.all.f1)}`);
      console.log(`          same generator for both conditions: ${summary.sameGeneratorForBothConditions}; failures: ${summary.failures.length}`);
      if (summary.failures.length) for (const fl of summary.failures) console.log(`          - ${fl}`);
    } else throw new Error(`unknown command: ${step}`);
  }
  console.log(`run: ${runDir} (manifest ${manifest.createdAt}, git ${manifest.gitCommit})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
