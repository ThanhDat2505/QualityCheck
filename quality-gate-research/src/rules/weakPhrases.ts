import { matchPhrases, type Rule } from "./rule.ts";

export const WEAK_PHRASES = [
  "if necessary", "as required", "as needed", "as appropriate", "where appropriate", "if possible", "whenever possible",
  "as far as possible", "etc.", "and so on", "such as", "e.g.", "for example", "to the maximum practicable extent",
  "as an objective", "should be a goal",
] as const;

export const weakPhraseRule: Rule = {
  id: "AMB-WEAK-001",
  issueType: "AMBIGUITY",
  description: "Escape clause or open-ended list (plan M2.4).",
  example: "Reports shall be generated as needed. -> span 'as needed'",
  message: "Open-ended or escape-clause phrase",
  findSpans: (text) => matchPhrases(text, WEAK_PHRASES),
};

// Unfilled template placeholders such as <xx>, [SYSTEM NAME], xxx.
export const placeholderRule: Rule = {
  id: "AMB-PLACEHOLDER-001",
  issueType: "AMBIGUITY",
  description: "Unfilled template placeholder.",
  example: "The System must be available from <xx:00>. -> span '<xx:00>'",
  message: "Unfilled placeholder value",
  findSpans: (text) => [...text.matchAll(/<[^<>]{1,40}>|\[[A-Za-z ]{2,30}\]|\bx{2,}\b/gi)].map((m) => m[0]),
};

// Content that lives only in a figure, table or appendix that is not part of the input.
export const externalReferenceRule: Rule = {
  id: "INC-REF-001",
  issueType: "INCOMPLETENESS",
  description: "Content delegated to a figure, table, appendix or another section.",
  example: "The procedure is shown in table 14-4. -> span 'shown in table 14-4'",
  message: "Content referenced elsewhere; may be missing for the target diagram",
  findSpans: (text) =>
    [...text.matchAll(/\b(?:shown|defined|specified|described|outlined|as)\s+in\s+(?:the\s+)?(?:figure|table|appendix|section)s?\s+[\w-]+(?:\.[\w-]+)*(?:\s+and\s+\d+(?:\.\d+)*)?/gi)].map((m) => m[0]),
};
