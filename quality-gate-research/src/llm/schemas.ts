import { z } from "zod";

// JSON schemas the LLM must return (plan M3.2). strictObject => additionalProperties: false, and
// optional values are nullable rather than omitted so structured outputs can require every field.

export const IssueSchema = z.strictObject({
  type: z.enum(["AMBIGUITY", "INCOMPLETENESS", "POTENTIAL_INCONSISTENCY"]),
  span: z.string().nullable().describe("Exact substring of the requirement text, or null"),
  reason: z.string().min(1),
  question: z.string().min(1).describe("The minimum targeted question a stakeholder must answer"),
  relatedRequirementIds: z.array(z.string()),
});

export const AnalysisSchema = z.strictObject({
  status: z.enum(["CLEAR", "NEEDS_CLARIFICATION"]),
  issues: z.array(IssueSchema),
});

export const RewriteSchema = z.strictObject({
  rewrittenText: z.string().min(1),
  usedAnswerIds: z.array(z.string()).describe("Ids of the confirmed answers used in the rewrite"),
});

const Name = z.string().min(1);
export const UmlSchema = z.strictObject({
  actors: z.array(Name),
  classes: z.array(Name),
  useCases: z.array(Name),
  operations: z.array(Name),
  relationships: z.array(z.strictObject({ from: Name, to: Name, type: Name })),
  messages: z.array(z.strictObject({ from: Name, to: Name, name: Name })),
});

export type AnalysisOutput = z.infer<typeof AnalysisSchema>;
export type RewriteOutput = z.infer<typeof RewriteSchema>;
export type UmlOutput = z.infer<typeof UmlSchema>;
