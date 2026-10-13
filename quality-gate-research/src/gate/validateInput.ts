import { DIAGRAM_TYPES, type RequirementInput } from "../types/qualityGate.ts";

export class InvalidRequirementError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid requirement input: ${problems.join("; ")}`);
    this.name = "InvalidRequirementError";
    this.problems = problems;
  }
}

// Rejects inputs the Gate must not process (plan M2.6): empty text, invalid diagram, missing id,
// malformed related requirements. Returns the input unchanged when it is valid.
export function validateRequirementInput(input: unknown): RequirementInput {
  const problems: string[] = [];
  const r = (input ?? {}) as Partial<RequirementInput>;
  if (typeof r.id !== "string" || !r.id.trim()) problems.push("missing id");
  if (typeof r.text !== "string" || !r.text.trim()) problems.push("empty requirement text");
  if (!DIAGRAM_TYPES.includes(r.targetDiagram as never)) problems.push(`invalid targetDiagram: ${String(r.targetDiagram)}`);
  if (r.context !== undefined && (!Array.isArray(r.context) || r.context.some((c) => typeof c !== "string"))) {
    problems.push("context must be an array of strings");
  }
  if (r.relatedRequirements !== undefined) {
    if (!Array.isArray(r.relatedRequirements)) problems.push("relatedRequirements must be an array");
    else
      r.relatedRequirements.forEach((rel, i) => {
        if (!rel || typeof rel.id !== "string" || !rel.id.trim() || typeof rel.text !== "string" || !rel.text.trim()) {
          problems.push(`relatedRequirements[${i}] needs non-empty id and text`);
        } else if (rel.id === r.id) problems.push(`relatedRequirements[${i}] refers to the requirement itself`);
      });
  }
  if (problems.length) throw new InvalidRequirementError(problems);
  return r as RequirementInput;
}
