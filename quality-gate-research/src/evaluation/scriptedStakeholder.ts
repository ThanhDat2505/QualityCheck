import { readFileSync } from "node:fs";
import type { Stakeholder } from "../gate/clarificationSession.ts";

// A stand-in stakeholder for smoke tests and pilot dry runs (plan I3). It answers from a fixture
// file and always confirms the rewrite. Never use it for the main experiment: human effort and
// answer quality are part of what is measured there.
//
// Fixture format: { "<requirementId>": [{ "match": "adequate", "answer": "..." }, { "match": "*", "answer": "..." }] }
// An answer is used for every question whose text or span contains `match` (case-insensitive);
// "*" answers any question nothing else matched.
export type AnswerFixture = Record<string, { match: string; answer: string }[]>;

export function loadAnswerFixture(path: string): AnswerFixture {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => !k.startsWith("_") && Array.isArray(v))) as AnswerFixture;
}

export function scriptedStakeholder(entries: { match: string; answer: string }[] = []): Stakeholder {
  return {
    async answer(questions) {
      return questions.map((q) => {
        const hay = `${q.question} ${q.span ?? ""}`.toLowerCase();
        const hit = entries.find((e) => e.match !== "*" && hay.includes(e.match.toLowerCase())) ?? entries.find((e) => e.match === "*");
        return { id: q.id, question: q.question, answer: hit?.answer ?? "" };
      });
    },
    async confirm(_original, rewritten) {
      return { decision: "CONFIRM", finalText: rewritten };
    },
  };
}
