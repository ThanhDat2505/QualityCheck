import type { GoldLabel } from "../types/qualityGate.ts";
import { prf, type Prf } from "./metrics.ts";

export interface DetectionItem {
  requirementId: string;
  gold: GoldLabel;
  predicted: GoldLabel;
}

export interface DetectionReport extends Prf {
  n: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  falsePositiveRateOnClear: number; // share of gold-CLEAR requirements the Gate flagged
  falseNegativeRateOnProblematic: number; // share of gold-problematic requirements the Gate passed
  exactLabelAccuracy: number; // predicted label == gold label (5 classes)
  perLabel: Record<string, Prf & { support: number }>;
}

// Gate detection vs. human gold labels (plan 12.1). Positive class = "problematic" (any label but CLEAR).
export function detectionReport(items: DetectionItem[]): DetectionReport {
  let tp = 0, fp = 0, fn = 0, tn = 0, exact = 0;
  for (const it of items) {
    const g = it.gold !== "CLEAR";
    const p = it.predicted !== "CLEAR";
    if (g && p) tp++;
    else if (!g && p) fp++;
    else if (g && !p) fn++;
    else tn++;
    if (it.gold === it.predicted) exact++;
  }
  const labels: GoldLabel[] = ["CLEAR", "AMBIGUOUS", "INCOMPLETE_FOR_TARGET", "POTENTIAL_INCONSISTENCY", "MULTIPLE_ISSUES"];
  const perLabel: DetectionReport["perLabel"] = {};
  for (const l of labels) {
    const c = { tp: 0, fp: 0, fn: 0 };
    for (const it of items) {
      if (it.gold === l && it.predicted === l) c.tp++;
      else if (it.gold !== l && it.predicted === l) c.fp++;
      else if (it.gold === l && it.predicted !== l) c.fn++;
    }
    perLabel[l] = { ...prf(c), support: items.filter((i) => i.gold === l).length };
  }
  const ratio = (a: number, b: number) => (b === 0 ? NaN : a / b);
  return {
    n: items.length,
    tp, fp, fn, tn,
    ...prf({ tp, fp, fn }),
    falsePositiveRateOnClear: ratio(fp, fp + tn),
    falseNegativeRateOnProblematic: ratio(fn, fn + tp),
    exactLabelAccuracy: ratio(exact, items.length),
    perLabel,
  };
}

// Cohen's kappa between two annotators on the 5-label scheme (plan section 10, optional).
export function cohensKappa(a: GoldLabel[], b: GoldLabel[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  const n = a.length;
  const observed = a.filter((x, i) => x === b[i]).length / n;
  const labels = new Set([...a, ...b]);
  let expected = 0;
  for (const l of labels) expected += (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n);
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}
