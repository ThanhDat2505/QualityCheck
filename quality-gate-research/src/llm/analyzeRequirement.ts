import type { LlmAnalysis } from "../gate/decisionEngine.ts";
import type { QualityIssue, RequirementInput, RuleHint } from "../types/qualityGate.ts";
import { ANALYZE_SYSTEM, analyzeUser, PROMPT_VERSION } from "./prompts.ts";
import type { LlmProvider, LlmTask } from "./provider.ts";
import { AnalysisSchema, type AnalysisOutput } from "./schemas.ts";

export function toIssues(output: AnalysisOutput, allowed: QualityIssue["type"][]): QualityIssue[] {
  return output.issues
    .filter((i) => allowed.includes(i.type))
    .map((i) => ({
      type: i.type,
      ...(i.span ? { span: i.span } : {}),
      reason: i.reason,
      question: i.question,
      ...(i.relatedRequirementIds.length ? { relatedRequirementIds: i.relatedRequirementIds } : {}),
    }));
}

// Ambiguity + incompleteness for the target diagram (plan M3.3, M3.4).
export async function analyzeRequirement(provider: LlmProvider, input: RequirementInput, hints: RuleHint[], task: LlmTask = "analyze"): Promise<LlmAnalysis> {
  const output = await provider.completeJson({
    task,
    promptVersion: PROMPT_VERSION,
    requirementId: input.id,
    system: ANALYZE_SYSTEM,
    user: analyzeUser(input, hints),
    schema: AnalysisSchema,
  });
  const issues = toIssues(output, ["AMBIGUITY", "INCOMPLETENESS"]);
  return { status: issues.length ? "NEEDS_CLARIFICATION" : output.status, issues };
}
