import type { DiagramType } from "../types/qualityGate.ts";
import { SCORED_FIELDS, type NormalizedUmlModel } from "../types/uml.ts";
import { normalizeModel } from "../uml/normalize.ts";

export const METRIC_VERSION = "v0.1";

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
}

export interface Prf {
  precision: number;
  recall: number;
  f1: number;
}

// Conventions (documented in docs/experiment-protocol.md):
// - nothing generated and nothing expected -> P = R = F1 = 1 (perfect agreement on "empty");
// - nothing generated but something expected -> P = 0 (not undefined), R = 0;
// - something generated but nothing expected -> P = 0, R = 0.
export function prf({ tp, fp, fn }: Counts): Prf {
  if (tp + fp + fn === 0) return { precision: 1, recall: 1, f1: 1 };
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function keys(m: NormalizedUmlModel, field: keyof NormalizedUmlModel): Set<string> {
  const values = m[field] as unknown[];
  return new Set(values.map((v) => (typeof v === "string" ? v : Object.values(v as object).join("|"))));
}

// Micro-averaged element matching over the fields scored for the diagram type (plan M5.5).
export function compareModels(generated: NormalizedUmlModel, reference: NormalizedUmlModel, diagram: DiagramType): Counts & Prf {
  const g = normalizeModel(generated);
  const r = normalizeModel(reference);
  const c: Counts = { tp: 0, fp: 0, fn: 0 };
  for (const field of SCORED_FIELDS[diagram]) {
    const gs = keys(g, field);
    const rs = keys(r, field);
    for (const k of gs) if (rs.has(k)) c.tp++;
    else c.fp++;
    for (const k of rs) if (!gs.has(k)) c.fn++;
  }
  return { ...c, ...prf(c) };
}

// Macro average: mean of per-item scores.
export function macro(items: Prf[]): Prf {
  if (items.length === 0) return { precision: NaN, recall: NaN, f1: NaN };
  const mean = (k: keyof Prf) => items.reduce((s, x) => s + x[k], 0) / items.length;
  return { precision: mean("precision"), recall: mean("recall"), f1: mean("f1") };
}
