import type { GateResult, QualityIssue, RuleHint } from "../types/qualityGate.ts";

export const DECISION_VERSION = "v0.1";

export interface LlmAnalysis {
  status: "CLEAR" | "NEEDS_CLARIFICATION";
  issues: QualityIssue[];
}

// Combines deterministic hints with the LLM analysis (plan M2.5). Deliberately simple, no scoring:
// - the LLM decides; rule hints are attached for the reviewer but never block on their own,
//   because rules only flag candidates (a pronoun is not automatically ambiguous);
// - an LLM "CLEAR" that still lists issues is treated as NEEDS_CLARIFICATION (inconsistent output);
// - issues are de-duplicated by (type, span).
export function decide(requirementId: string, ruleHints: RuleHint[], analysis: LlmAnalysis): GateResult {
  const seen = new Set<string>();
  const issues = analysis.issues.filter((i) => {
    const key = `${i.type}|${(i.span ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const status = analysis.status === "NEEDS_CLARIFICATION" || issues.length > 0 ? "NEEDS_CLARIFICATION" : "CLEAR";
  return { requirementId, status, issues: status === "CLEAR" ? [] : issues, ruleHints };
}
