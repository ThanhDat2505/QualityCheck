import { runQualityGate } from "../gate/qualityGate.ts";
import type { GateResult, RequirementInput } from "../types/qualityGate.ts";
import type { LlmProvider } from "./provider.ts";

// Plan M3.7: the clarified text goes through the same Gate again. The caller enforces the
// maximum number of clarification rounds (see gate/clarificationSession.ts).
export function recheckRequirement(provider: LlmProvider, input: RequirementInput, clarifiedText: string): Promise<GateResult> {
  return runQualityGate(provider, { ...input, text: clarifiedText }, "recheck");
}
