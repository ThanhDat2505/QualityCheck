import type { RuleHint } from "../types/qualityGate.ts";
import { applyRule, type Rule } from "./rule.ts";
import { pronounRule } from "./pronounRules.ts";
import { unboundedLimitRule, vagueTermRule } from "./vagueTerms.ts";
import { externalReferenceRule, placeholderRule, weakPhraseRule } from "./weakPhrases.ts";

export const RULES_VERSION = "v0.1";

export const RULES: readonly Rule[] = [vagueTermRule, unboundedLimitRule, pronounRule, weakPhraseRule, placeholderRule, externalReferenceRule];

// Runs every rule; works without the LLM (plan M2 completion criteria). Duplicate (rule, span) pairs are dropped.
export function checkRules(text: string): RuleHint[] {
  const seen = new Set<string>();
  const hints: RuleHint[] = [];
  for (const rule of RULES) {
    for (const hint of applyRule(rule, text)) {
      const key = `${hint.ruleId}|${hint.span?.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push(hint);
    }
  }
  return hints;
}
