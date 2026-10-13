import { analyzeConsistency } from "../llm/analyzeConsistency.ts";
import { analyzeRequirement } from "../llm/analyzeRequirement.ts";
import type { LlmProvider, LlmTask } from "../llm/provider.ts";
import { checkRules } from "../rules/ruleChecker.ts";
import type { GateResult, RequirementInput } from "../types/qualityGate.ts";
import { decide } from "./decisionEngine.ts";
import { validateRequirementInput } from "./validateInput.ts";

// Full Gate pass: validate -> rules -> LLM (ambiguity/incompleteness + consistency) -> decision.
// LlmError propagates to the caller, which records a controlled failure; nothing is fabricated here.
export async function runQualityGate(provider: LlmProvider, raw: unknown, task: LlmTask = "analyze"): Promise<GateResult> {
  const input = validateRequirementInput(raw);
  const hints = checkRules(input.text);
  const [quality, consistency] = await Promise.all([analyzeRequirement(provider, input, hints, task), analyzeConsistency(provider, input)]);
  return decide(input.id, hints, {
    status: quality.status === "NEEDS_CLARIFICATION" || consistency.status === "NEEDS_CLARIFICATION" ? "NEEDS_CLARIFICATION" : "CLEAR",
    issues: [...quality.issues, ...consistency.issues],
  });
}
