import type { DiagramType, RequirementInput, RuleHint } from "../types/qualityGate.ts";

// Prompt texts are part of the experimental setup: change them only before the pilot freeze and
// bump PROMPT_VERSION whenever any text below changes (plan M3.8, section 9).
export const PROMPT_VERSION = "v0.1";

export const DIAGRAM_NEEDS: Record<DiagramType, string> = {
  USE_CASE: "the actor(s) who perform or benefit, and the goal/action of each actor",
  CLASS: "the main entities and at least their attributes or the relationships between them",
  SEQUENCE: "the participants, who initiates, the messages exchanged and their basic order",
};

export const ANALYZE_SYSTEM = `You are a software requirements quality analyst.
Check only:
1. ambiguity - more than one reasonable reading, a vague or non-measurable term, an unresolved reference, an undefined condition or an unfilled placeholder;
2. incompleteness for the intended UML diagram - the requirement is understandable, but the target diagram cannot be produced without inventing actors, entities, attributes, participants or messages;
3. potential inconsistency - only when related requirements are given and appear incompatible with this one.
Rules:
- Do not invent business rules. Do not resolve uncertainty by guessing.
- Use the context only to resolve references; a pronoun whose referent is clear from the context is not ambiguous.
- Rule hints come from simple keyword rules. They are candidates, not findings: confirm or ignore each one.
- Style, grammar and spelling are out of scope unless they change the meaning.
- For each issue, quote the exact span from the requirement text when there is one, and ask the minimum targeted question a stakeholder must answer.
- Never call a conflict certain: report it as a potential inconsistency that needs confirmation.
- If there is no issue, return status CLEAR with an empty issue list.
Return only the JSON object required by the schema.`;

function list(items: string[]): string {
  return items.length ? items.map((s) => `- ${s}`).join("\n") : "(none)";
}

export function analyzeUser(input: RequirementInput, hints: RuleHint[]): string {
  return [
    `Requirement id: ${input.id}`,
    `Requirement text: ${input.text}`,
    `Target diagram: ${input.targetDiagram}`,
    `A ${input.targetDiagram} diagram needs: ${DIAGRAM_NEEDS[input.targetDiagram]}.`,
    `Question for incompleteness: can a ${input.targetDiagram} diagram be produced from this requirement without inventing any of these?`,
    "Context:",
    list(input.context ?? []),
    "Rule hints:",
    list(hints.map((h) => `${h.ruleId} (${h.issueType}) span="${h.span ?? ""}": ${h.message}`)),
    "Report only AMBIGUITY and INCOMPLETENESS issues here; set relatedRequirementIds to [] for each issue.",
  ].join("\n");
}

export const CONSISTENCY_SYSTEM = `You are a software requirements quality analyst checking for potential inconsistency.
Compare the requirement with each related requirement. Report a POTENTIAL_INCONSISTENCY issue only when they appear incompatible
(same situation but different behaviour, thresholds, permissions or data). Complementary, more detailed or duplicate requirements are not inconsistent.
Do not say a requirement is wrong; a stakeholder must confirm. Put the ids of the conflicting related requirements in relatedRequirementIds.
Use only POTENTIAL_INCONSISTENCY as the issue type. If nothing conflicts, return status CLEAR with an empty issue list.
Return only the JSON object required by the schema.`;

export function consistencyUser(input: RequirementInput): string {
  return [
    `Requirement ${input.id}: ${input.text}`,
    "Related requirements:",
    list((input.relatedRequirements ?? []).map((r) => `${r.id}: ${r.text}`)),
  ].join("\n");
}

export interface ConfirmedAnswer {
  id: string; // e.g. "Q1"
  question: string;
  answer: string;
}

export const REWRITE_SYSTEM = `You rewrite a software requirement using stakeholder answers.
Rewrite using only confirmed information: the original requirement and the confirmed answers.
Do not add new actors, rules, thresholds or behaviour. Keep everything that the answers do not change.
Use "shall" for mandatory behaviour. Produce a single requirement statement (one or two sentences).
List the ids of the answers you used. Return only the JSON object required by the schema.`;

export function rewriteUser(original: string, targetDiagram: DiagramType, answers: ConfirmedAnswer[]): string {
  return [
    `Original requirement: ${original}`,
    `Target diagram: ${targetDiagram}`,
    "Confirmed answers:",
    list(answers.map((a) => `${a.id} | Q: ${a.question} | A: ${a.answer}`)),
  ].join("\n");
}
