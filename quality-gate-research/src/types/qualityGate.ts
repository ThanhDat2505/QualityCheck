// Shared contract for all modules (plan M2.1). Changing a field here is a breaking change:
// bump CONTRACT_VERSION and tell members 3, 4 and 5.

export const CONTRACT_VERSION = "v0.1";

export type DiagramType = "USE_CASE" | "CLASS" | "SEQUENCE";
export const DIAGRAM_TYPES: readonly DiagramType[] = ["USE_CASE", "CLASS", "SEQUENCE"];

export type IssueType = "AMBIGUITY" | "INCOMPLETENESS" | "POTENTIAL_INCONSISTENCY";
export const ISSUE_TYPES: readonly IssueType[] = ["AMBIGUITY", "INCOMPLETENESS", "POTENTIAL_INCONSISTENCY"];

export type GateStatus = "CLEAR" | "NEEDS_CLARIFICATION";

export interface RequirementInput {
  id: string;
  text: string;
  targetDiagram: DiagramType;
  context?: string[];
  relatedRequirements?: {
    id: string;
    text: string;
  }[];
}

export interface RuleHint {
  ruleId: string;
  issueType: IssueType;
  span?: string;
  message: string;
}

export interface QualityIssue {
  type: IssueType;
  span?: string;
  reason: string;
  question: string;
  relatedRequirementIds?: string[];
}

export interface GateResult {
  requirementId: string;
  status: GateStatus;
  issues: QualityIssue[];
  ruleHints: RuleHint[];
}

// Labels used by human annotation (data/annotations) and for scoring Gate detection.
export type GoldLabel = "CLEAR" | "AMBIGUOUS" | "INCOMPLETE_FOR_TARGET" | "POTENTIAL_INCONSISTENCY" | "MULTIPLE_ISSUES";

// Maps a Gate result to the annotation label space so it can be compared with gold.csv.
export function gateResultToLabel(result: GateResult): GoldLabel {
  const types = new Set(result.issues.map((i) => i.type));
  if (result.status === "CLEAR" || types.size === 0) return "CLEAR";
  if (types.size > 1) return "MULTIPLE_ISSUES";
  const [only] = types;
  return only === "AMBIGUITY" ? "AMBIGUOUS" : only === "INCOMPLETENESS" ? "INCOMPLETE_FOR_TARGET" : "POTENTIAL_INCONSISTENCY";
}
