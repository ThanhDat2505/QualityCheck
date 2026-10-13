import type { QualityIssue } from "../types/qualityGate.ts";

export interface ClarificationQuestion {
  id: string; // Q1, Q2, ... stable within one round
  question: string;
  issueTypes: QualityIssue["type"][];
  span?: string;
}

// Turns Gate issues into the questions shown to the stakeholder. The analysis prompt already asks
// for "the minimum targeted question" per issue, so this step is deterministic: it only merges
// identical questions and numbers them. No extra LLM call, no new content.
export function generateClarification(issues: QualityIssue[]): ClarificationQuestion[] {
  const byText = new Map<string, ClarificationQuestion>();
  for (const issue of issues) {
    const key = issue.question.trim().toLowerCase();
    const existing = byText.get(key);
    if (existing) {
      if (!existing.issueTypes.includes(issue.type)) existing.issueTypes.push(issue.type);
      continue;
    }
    byText.set(key, { id: "", question: issue.question.trim(), issueTypes: [issue.type], ...(issue.span ? { span: issue.span } : {}) });
  }
  return [...byText.values()].map((q, i) => ({ ...q, id: `Q${i + 1}` }));
}
