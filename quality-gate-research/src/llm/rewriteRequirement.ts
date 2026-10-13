import type { DiagramType } from "../types/qualityGate.ts";
import { PROMPT_VERSION, REWRITE_SYSTEM, rewriteUser, type ConfirmedAnswer } from "./prompts.ts";
import type { LlmProvider } from "./provider.ts";
import { RewriteSchema } from "./schemas.ts";

export interface RewriteResult {
  rewrittenText: string;
  usedAnswerIds: string[];
}

// Rewrites with confirmed stakeholder answers only (plan M3.6). The result is a proposal:
// a human must confirm or edit it before it goes to the UML pipeline (plan M4).
export async function rewriteRequirement(
  provider: LlmProvider,
  requirementId: string,
  original: string,
  targetDiagram: DiagramType,
  answers: ConfirmedAnswer[],
): Promise<RewriteResult> {
  const usable = answers.filter((a) => a.answer.trim());
  if (usable.length === 0) return { rewrittenText: original, usedAnswerIds: [] };
  const output = await provider.completeJson({
    task: "rewrite",
    promptVersion: PROMPT_VERSION,
    requirementId,
    system: REWRITE_SYSTEM,
    user: rewriteUser(original, targetDiagram, usable),
    schema: RewriteSchema,
  });
  const known = new Set(usable.map((a) => a.id));
  return { rewrittenText: output.rewrittenText.trim(), usedAnswerIds: output.usedAnswerIds.filter((id) => known.has(id)) };
}
