import { matchPhrases, type Rule } from "./rule.ts";

// Starter list from plan M2.2. Keep it small and explicit; extend only with a test per term.
export const VAGUE_TERMS = [
  "quickly", "fast", "efficiently", "efficient", "user-friendly", "user friendly", "appropriate", "appropriately",
  "sufficient", "adequate", "easy", "easily", "normally", "usually", "as soon as possible", "minimal", "high", "low",
] as const;

export const vagueTermRule: Rule = {
  id: "AMB-VAGUE-001",
  issueType: "AMBIGUITY",
  description: "Subjective or non-measurable quality term.",
  example: "The system shall respond quickly. -> span 'quickly'",
  message: "Potential vague or non-measurable term",
  findSpans: (text) => matchPhrases(text, VAGUE_TERMS),
};

// "maximum"/"minimum" without a value in the next few words, e.g. "a maximum number of units".
export const unboundedLimitRule: Rule = {
  id: "AMB-VAGUE-002",
  issueType: "AMBIGUITY",
  description: "Maximum or minimum mentioned without a value.",
  example: "There shall be a maximum number of units. -> span 'maximum'",
  message: "Limit mentioned without a stated value",
  findSpans: (text) =>
    [...text.matchAll(/\b(maximum|minimum)\b(?![^.;]{0,25}?\d)/gi)].map((m) => m[0]),
};
