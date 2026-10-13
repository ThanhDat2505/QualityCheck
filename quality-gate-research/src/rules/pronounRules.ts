import { matchPhrases, type Rule } from "./rule.ts";

export const REFERENCE_WORDS = ["it", "this", "these", "those", "they", "them"] as const;

// Flags pronouns and demonstratives so the LLM checks them against the context (plan M2.3).
// Not every pronoun is ambiguous: this rule only produces a hint.
// "that" is flagged only where it opens a clause ("That shall be logged."); as a relative pronoun
// ("data that is stored") it is almost never a reference problem and would drown the hints.
export const pronounRule: Rule = {
  id: "AMB-PRON-001",
  issueType: "AMBIGUITY",
  description: "Pronoun or demonstrative whose referent must be checked against the context.",
  example: "The system should process it quickly. -> span 'it'",
  message: "Possible unclear reference; check the referent in the context",
  findSpans: (text) => [
    ...matchPhrases(text, REFERENCE_WORDS),
    ...[...text.matchAll(/(?:^|[.;:,]\s+)(that)\b/gi)].map((m) => m[1]),
  ],
};
