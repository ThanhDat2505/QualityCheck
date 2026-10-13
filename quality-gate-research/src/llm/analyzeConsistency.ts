import type { LlmAnalysis } from "../gate/decisionEngine.ts";
import type { RequirementInput } from "../types/qualityGate.ts";
import { toIssues } from "./analyzeRequirement.ts";
import { CONSISTENCY_SYSTEM, consistencyUser, PROMPT_VERSION } from "./prompts.ts";
import type { LlmProvider } from "./provider.ts";
import { AnalysisSchema } from "./schemas.ts";

// Potential inconsistency is judged against related requirements, never in isolation (plan M3.5).
// Without related requirements there is nothing to compare, so no API call is made.
export async function analyzeConsistency(provider: LlmProvider, input: RequirementInput): Promise<LlmAnalysis> {
  const related = input.relatedRequirements ?? [];
  if (related.length === 0) return { status: "CLEAR", issues: [] };
  const output = await provider.completeJson({
    task: "consistency",
    promptVersion: PROMPT_VERSION,
    requirementId: input.id,
    system: CONSISTENCY_SYSTEM,
    user: consistencyUser(input),
    schema: AnalysisSchema,
  });
  const known = new Set(related.map((r) => r.id));
  const issues = toIssues(output, ["POTENTIAL_INCONSISTENCY"])
    .map((i) => ({ ...i, relatedRequirementIds: (i.relatedRequirementIds ?? []).filter((id) => known.has(id)) }))
    .filter((i) => i.relatedRequirementIds.length > 0); // an inconsistency must point to a given requirement
  return { status: issues.length ? "NEEDS_CLARIFICATION" : "CLEAR", issues };
}
