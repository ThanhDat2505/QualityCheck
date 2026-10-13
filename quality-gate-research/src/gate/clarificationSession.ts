import { generateClarification, type ClarificationQuestion } from "../llm/generateClarification.ts";
import type { ConfirmedAnswer } from "../llm/prompts.ts";
import type { LlmProvider } from "../llm/provider.ts";
import { recheckRequirement } from "../llm/recheckRequirement.ts";
import { rewriteRequirement } from "../llm/rewriteRequirement.ts";
import type { GateResult, QualityIssue, RequirementInput } from "../types/qualityGate.ts";
import { runQualityGate } from "./qualityGate.ts";

export const MAX_CLARIFICATION_ROUNDS = 2;

// Who answers the questions and who confirms the rewrite. In the web UI both are humans
// (members 4); in scripted runs (smoke tests) both come from a fixture file, which must be stated in results.
export interface Stakeholder {
  answer(questions: ClarificationQuestion[], round: number): Promise<ConfirmedAnswer[]>;
  confirm(original: string, rewritten: string): Promise<{ decision: "CONFIRM" | "EDIT"; finalText: string }>;
}

export interface SessionRecord {
  requirementId: string;
  originalText: string;
  gateStatus: GateResult["status"];
  issues: QualityIssue[];
  rounds: { questions: ClarificationQuestion[]; answers: ConfirmedAnswer[]; rewrittenText: string; recheck: GateResult }[];
  answers: ConfirmedAnswer[];
  clarifiedText: string;
  finalText: string;
  humanEdited: boolean;
  questionCount: number;
  unresolvedIssues: QualityIssue[]; // issues still reported after the last recheck
}

// Plan sections 0 and M3.7: analyze -> questions -> answers -> rewrite -> recheck, at most
// MAX_CLARIFICATION_ROUNDS rounds, then the human confirms or edits the final text.
export async function runClarificationSession(provider: LlmProvider, input: RequirementInput, stakeholder: Stakeholder): Promise<SessionRecord> {
  const gate = await runQualityGate(provider, input);
  const record: SessionRecord = {
    requirementId: input.id,
    originalText: input.text,
    gateStatus: gate.status,
    issues: gate.issues,
    rounds: [],
    answers: [],
    clarifiedText: input.text,
    finalText: input.text,
    humanEdited: false,
    questionCount: 0,
    unresolvedIssues: gate.issues,
  };
  if (gate.status === "CLEAR") return record;

  let issues = gate.issues;
  let text = input.text;
  for (let round = 1; round <= MAX_CLARIFICATION_ROUNDS && issues.length > 0; round++) {
    const questions = generateClarification(issues).map((q) => ({ ...q, id: `R${round}${q.id}` }));
    const answers = await stakeholder.answer(questions, round);
    record.questionCount += questions.length;
    record.answers.push(...answers);
    if (!answers.some((a) => a.answer.trim())) break; // stakeholder could not answer: stop, keep issues unresolved
    const rewrite = await rewriteRequirement(provider, input.id, text, input.targetDiagram, answers);
    text = rewrite.rewrittenText;
    const recheck = await recheckRequirement(provider, input, text);
    record.rounds.push({ questions, answers, rewrittenText: text, recheck });
    issues = recheck.issues;
  }
  record.clarifiedText = text;
  record.unresolvedIssues = issues;
  const confirmation = await stakeholder.confirm(input.text, text);
  record.finalText = confirmation.finalText;
  record.humanEdited = confirmation.decision === "EDIT" && confirmation.finalText !== text;
  return record;
}
