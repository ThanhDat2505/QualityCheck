import type { IssueType, RuleHint } from "../types/qualityGate.ts";

// A deterministic rule. It never concludes that a requirement is wrong: it only returns hints
// (span + message) for the LLM and the reviewer to look at (plan M2.2).
export interface Rule {
  id: string;
  issueType: IssueType;
  description: string;
  example: string;
  message: string;
  findSpans(text: string): string[];
}

export function applyRule(rule: Rule, text: string): RuleHint[] {
  return rule.findSpans(text).map((span) => ({ ruleId: rule.id, issueType: rule.issueType, span, message: rule.message }));
}

// Whole-word, case-insensitive matches of a phrase list; returns the text as written in the requirement.
export function matchPhrases(text: string, phrases: readonly string[]): string[] {
  const spans: string[] = [];
  for (const phrase of phrases) {
    const pattern = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    for (const m of text.matchAll(new RegExp(`(?<![\\w-])${pattern}(?![\\w-])`, "gi"))) spans.push(m[0]);
  }
  return spans;
}
