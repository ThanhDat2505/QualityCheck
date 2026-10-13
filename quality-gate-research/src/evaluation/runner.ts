import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DECISION_VERSION } from "../gate/decisionEngine.ts";
import { runClarificationSession, type SessionRecord, type Stakeholder } from "../gate/clarificationSession.ts";
import { runQualityGate } from "../gate/qualityGate.ts";
import { PROMPT_VERSION } from "../llm/prompts.ts";
import { LlmError, type LlmProvider } from "../llm/provider.ts";
import { RULES_VERSION } from "../rules/ruleChecker.ts";
import { CONTRACT_VERSION, gateResultToLabel, type GateResult, type GoldLabel } from "../types/qualityGate.ts";
import type { NormalizedUmlModel, UmlGenerator } from "../types/uml.ts";
import { NORMALIZATION_VERSION } from "../uml/normalize.ts";
import type { DatasetRow } from "./dataset.ts";
import { detectionReport } from "./gateMetrics.ts";
import { compareModels, macro, METRIC_VERSION, type Prf } from "./metrics.ts";

// Experiment layout (one directory per run, never edited by hand — plan M5.9):
//   manifest.json          versions of every component + dataset + git commit
//   gate/<id>.json         Gate result (or {error})
//   sessions/<id>.json     clarification record: exported by the web UI, or written by a scripted stakeholder
//   baseline/<id>.json     UML from the original text
//   treatment/<id>.json    UML from the confirmed text
//   results.csv, summary.json

export interface Manifest {
  runId: string;
  createdAt: string;
  dataset: string;
  datasetVersion: string;
  contractVersion: string;
  rulesVersion: string;
  promptVersion: string;
  decisionVersion: string;
  normalizationVersion: string;
  metricVersion: string;
  provider: string;
  model: string;
  effort: string;
  umlGeneratorId: string;
  gitCommit: string;
  note: string;
}

export interface UmlRecord {
  requirementId: string;
  generatorId: string;
  inputText: string;
  model: NormalizedUmlModel | null;
  reusedFromBaseline?: boolean;
  error?: string;
}

// Export format of one reviewed requirement (plan M4.5), shared by the web UI and scripted runs.
export interface ExportRecord extends SessionRecord {
  participantId: string;
  stakeholder: "HUMAN" | "SCRIPTED";
  clarificationTimeMs: number | null;
  totalReviewTimeMs: number | null;
  manualEditTimeMs: number | null;
  clarificationRounds: number;
}

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const write = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export function initRun(dir: string, opts: Omit<Manifest, "runId" | "createdAt" | "contractVersion" | "rulesVersion" | "promptVersion" | "decisionVersion" | "normalizationVersion" | "metricVersion" | "gitCommit">): Manifest {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "manifest.json");
  const manifest: Manifest = {
    runId: dir.split(/[\\/]/).filter(Boolean).at(-1)!,
    createdAt: new Date().toISOString(),
    contractVersion: CONTRACT_VERSION,
    rulesVersion: RULES_VERSION,
    promptVersion: PROMPT_VERSION,
    decisionVersion: DECISION_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    metricVersion: METRIC_VERSION,
    gitCommit: gitCommit(),
    ...opts,
  };
  if (existsSync(path)) {
    // A run directory belongs to one frozen configuration: refuse to mix versions in one run.
    const old = json(path) as Manifest;
    const keys = ["dataset", "rulesVersion", "promptVersion", "decisionVersion", "normalizationVersion", "metricVersion", "provider", "model", "effort", "umlGeneratorId"] as const;
    const diff = keys.filter((k) => old[k] !== manifest[k]);
    if (diff.length) throw new Error(`${dir} was created with a different configuration (${diff.join(", ")}); use a new run directory`);
    return old;
  }
  write(path, manifest);
  return manifest;
}

// Existing outputs are kept: re-running a step only fills in missing items (resumable, no silent overwrite).
async function forEachMissing(dir: string, rows: DatasetRow[], fn: (row: DatasetRow) => Promise<unknown>): Promise<{ done: number; skipped: number; failed: number }> {
  mkdirSync(dir, { recursive: true });
  let done = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    const path = join(dir, `${row.input.id}.json`);
    if (existsSync(path)) {
      skipped++;
      continue;
    }
    const value = await fn(row);
    if ((value as { error?: string }).error) failed++;
    else done++;
    write(path, value);
  }
  return { done, skipped, failed };
}

const errorText = (e: unknown) => (e instanceof LlmError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export function runGateStep(runDir: string, rows: DatasetRow[], provider: LlmProvider) {
  return forEachMissing(join(runDir, "gate"), rows, async (row) => {
    try {
      return await runQualityGate(provider, row.input);
    } catch (e) {
      return { requirementId: row.input.id, error: errorText(e) };
    }
  });
}

export function runBaselineStep(runDir: string, rows: DatasetRow[], generator: UmlGenerator) {
  return forEachMissing(join(runDir, "baseline"), rows, async (row): Promise<UmlRecord> => {
    const base = { requirementId: row.input.id, generatorId: generator.id, inputText: row.input.text };
    try {
      return { ...base, model: await generator.generate(row.input.text, row.input.targetDiagram, row.input.id) };
    } catch (e) {
      return { ...base, model: null, error: errorText(e) };
    }
  });
}

// Scripted sessions are only for smoke/pilot development (plan I3); the main experiment uses UI exports.
export function runScriptedSessions(runDir: string, rows: DatasetRow[], provider: LlmProvider, stakeholderFor: (row: DatasetRow) => Stakeholder) {
  return forEachMissing(join(runDir, "sessions"), rows, async (row) => {
    try {
      const rec = await runClarificationSession(provider, row.input, stakeholderFor(row));
      const exp: ExportRecord = {
        ...rec,
        participantId: "scripted",
        stakeholder: "SCRIPTED",
        clarificationTimeMs: null,
        totalReviewTimeMs: null,
        manualEditTimeMs: null,
        clarificationRounds: rec.rounds.length,
      };
      return exp;
    } catch (e) {
      return { requirementId: row.input.id, error: errorText(e) };
    }
  });
}

export function runTreatmentStep(runDir: string, rows: DatasetRow[], generator: UmlGenerator) {
  return forEachMissing(join(runDir, "treatment"), rows, async (row): Promise<UmlRecord> => {
    const sessionPath = join(runDir, "sessions", `${row.input.id}.json`);
    const base = { requirementId: row.input.id, generatorId: generator.id };
    if (!existsSync(sessionPath)) return { ...base, inputText: "", model: null, error: "no confirmed session record" };
    const session = json(sessionPath) as ExportRecord & { error?: string };
    if (session.error) return { ...base, inputText: "", model: null, error: `session failed: ${session.error}` };
    const text = session.finalText;
    // Unchanged text: reuse the baseline output so the comparison isolates the Gate's effect
    // (documented in docs/experiment-protocol.md). The generator id must match.
    const baselinePath = join(runDir, "baseline", `${row.input.id}.json`);
    if (text === row.input.text && existsSync(baselinePath)) {
      const b = json(baselinePath) as UmlRecord;
      if (b.generatorId === generator.id && b.model) return { ...base, inputText: text, model: b.model, reusedFromBaseline: true };
    }
    try {
      return { ...base, inputText: text, model: await generator.generate(text, row.input.targetDiagram, row.input.id) };
    } catch (e) {
      return { ...base, inputText: text, model: null, error: errorText(e) };
    }
  });
}

export interface ResultRow {
  requirement_id: string;
  diagram_type: string;
  sampling: string;
  baseline_precision: number | null;
  baseline_recall: number | null;
  baseline_f1: number | null;
  gate_precision: number | null;
  gate_recall: number | null;
  gate_f1: number | null;
  delta_f1: number | null;
  gate_status: string;
  gate_issue_count: number | null;
  unresolved_issue_count: number | null;
  clarification_time_ms: number | null;
  question_count: number | null;
  clarification_rounds: number | null;
  human_edited: boolean | null;
  note: string;
}

const maybe = <T>(p: string): T | null => (existsSync(p) ? (json(p) as T) : null);

// Builds results.csv (plan M5.8) and summary.json (plan sections 12 and 13). Requirements without a
// reference model are listed with null UML scores; failed steps are counted, never silently dropped.
export function scoreRun(runDir: string, rows: DatasetRow[], referenceDir: string, gold?: Map<string, GoldLabel>) {
  const results: ResultRow[] = [];
  const umlScores: { diagram: string; sampling: string; base: Prf; gate: Prf }[] = [];
  const detection: { requirementId: string; gold: GoldLabel; predicted: GoldLabel; sampling: string }[] = [];
  const generatorIds = new Set<string>();
  const failures: string[] = [];

  for (const row of rows) {
    const id = row.input.id;
    const gate = maybe<GateResult & { error?: string }>(join(runDir, "gate", `${id}.json`));
    const session = maybe<ExportRecord & { error?: string }>(join(runDir, "sessions", `${id}.json`));
    const baseline = maybe<UmlRecord>(join(runDir, "baseline", `${id}.json`));
    const treatment = maybe<UmlRecord>(join(runDir, "treatment", `${id}.json`));
    const reference = maybe<NormalizedUmlModel>(join(referenceDir, `${id}.json`));
    const notes: string[] = [];
    for (const [name, v] of [["gate", gate], ["session", session], ["baseline", baseline], ["treatment", treatment]] as const) {
      if (!v) notes.push(`missing ${name}`);
      else if ((v as { error?: string }).error) {
        notes.push(`${name} error`);
        failures.push(`${id} ${name}: ${(v as { error?: string }).error}`);
      }
    }
    for (const u of [baseline, treatment]) if (u?.generatorId) generatorIds.add(u.generatorId);
    if (!reference) notes.push("no reference model");

    let b: Prf | null = null, g: Prf | null = null;
    if (reference && baseline?.model) b = compareModels(baseline.model, reference, row.input.targetDiagram);
    if (reference && treatment?.model) g = compareModels(treatment.model, reference, row.input.targetDiagram);
    if (b && g) umlScores.push({ diagram: row.input.targetDiagram, sampling: row.sampling, base: b, gate: g });

    const gateOk = gate && !gate.error ? gate : null;
    const sessionOk = session && !session.error ? session : null;
    if (gold?.has(id) && gateOk) detection.push({ requirementId: id, gold: gold.get(id)!, predicted: gateResultToLabel(gateOk), sampling: row.sampling });

    results.push({
      requirement_id: id,
      diagram_type: row.input.targetDiagram,
      sampling: row.sampling,
      baseline_precision: b?.precision ?? null,
      baseline_recall: b?.recall ?? null,
      baseline_f1: b?.f1 ?? null,
      gate_precision: g?.precision ?? null,
      gate_recall: g?.recall ?? null,
      gate_f1: g?.f1 ?? null,
      delta_f1: b && g ? g.f1 - b.f1 : null,
      gate_status: gateOk?.status ?? "ERROR",
      gate_issue_count: gateOk ? gateOk.issues.length : null,
      unresolved_issue_count: sessionOk ? sessionOk.unresolvedIssues.length : null,
      clarification_time_ms: sessionOk?.clarificationTimeMs ?? null,
      question_count: sessionOk ? sessionOk.questionCount : null,
      clarification_rounds: sessionOk ? sessionOk.clarificationRounds : null,
      human_edited: sessionOk ? sessionOk.humanEdited : null,
      note: notes.join("; "),
    });
  }

  const header = Object.keys(results[0] ?? {}) as (keyof ResultRow)[];
  const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 10000) / 10000) : `"${String(v).replace(/"/g, '""')}"`);
  writeFileSync(join(runDir, "results.csv"), [header.join(","), ...results.map((r) => header.map((h) => cell(r[h])).join(","))].join("\n") + "\n", "utf8");

  const byDiagram = (filter: (x: (typeof umlScores)[number]) => boolean) => {
    const sel = umlScores.filter(filter);
    return { n: sel.length, baseline: macro(sel.map((x) => x.base)), gate: macro(sel.map((x) => x.gate)) };
  };
  const reviewed = results.filter((r) => r.question_count !== null);
  const flagged = results.filter((r) => r.gate_status === "NEEDS_CLARIFICATION");
  const times = reviewed.map((r) => r.clarification_time_ms).filter((t): t is number => t !== null);
  const summary = {
    runDir,
    generatorIds: [...generatorIds],
    sameGeneratorForBothConditions: generatorIds.size <= 1,
    n: rows.length,
    failures,
    uml: {
      overall: byDiagram(() => true),
      randomOnly: byDiagram((x) => x.sampling !== "PINNED_PAIR"),
      USE_CASE: byDiagram((x) => x.diagram === "USE_CASE"),
      CLASS: byDiagram((x) => x.diagram === "CLASS"),
      SEQUENCE: byDiagram((x) => x.diagram === "SEQUENCE"),
    },
    requirementIssues: {
      gateIssuesBefore: flagged.reduce((s, r) => s + (r.gate_issue_count ?? 0), 0),
      unresolvedAfter: reviewed.reduce((s, r) => s + (r.unresolved_issue_count ?? 0), 0),
      recheckedClearRate: flagged.length ? flagged.filter((r) => r.unresolved_issue_count === 0).length / flagged.length : null,
    },
    humanEffort: {
      interventionRate: rows.length ? flagged.length / rows.length : null,
      questionsPerRequirement: reviewed.length ? reviewed.reduce((s, r) => s + (r.question_count ?? 0), 0) / rows.length : null,
      meanClarificationTimeMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      humanEditRate: flagged.length ? flagged.filter((r) => r.human_edited).length / flagged.length : null,
      meanRounds: flagged.length ? flagged.reduce((s, r) => s + (r.clarification_rounds ?? 0), 0) / flagged.length : null,
      timedSessions: times.length,
    },
    gateDetection: detection.length
      ? { all: detectionReport(detection), randomOnly: detectionReport(detection.filter((d) => d.sampling !== "PINNED_PAIR")) }
      : null,
  };
  write(join(runDir, "summary.json"), summary);
  return summary;
}

export function listSessionIds(runDir: string): string[] {
  const dir = join(runDir, "sessions");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
}
