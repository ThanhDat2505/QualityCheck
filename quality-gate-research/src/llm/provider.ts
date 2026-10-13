import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

// The single entry point to an LLM (plan M3.1). Tasks call completeJson(); nothing else in the
// project talks to an API. Every call is logged for reproducibility (plan M3.8) without secrets.

export type LlmTask = "analyze" | "consistency" | "rewrite" | "recheck" | "uml";

export interface JsonRequest<T> {
  task: LlmTask;
  promptVersion: string;
  requirementId?: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

export interface LlmProvider {
  readonly name: string; // "anthropic" | "mock"
  readonly model: string;
  readonly effort: string;
  completeJson<T>(req: JsonRequest<T>): Promise<T>;
}

export type LlmErrorKind = "invalid_json" | "refusal" | "truncated" | "api" | "network";

// Controlled error: callers catch it and show/record a failure instead of crashing or inventing a result (plan M3.2).
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly task: LlmTask;
  constructor(kind: LlmErrorKind, task: LlmTask, message: string) {
    super(`[${task}] ${kind}: ${message}`);
    this.name = "LlmError";
    this.kind = kind;
    this.task = task;
  }
}

export interface LlmCallLog {
  timestamp: string;
  provider: string;
  model: string;
  servedModel: string | null; // differs from model when a server-side fallback answered the request
  effort: string;
  task: LlmTask;
  promptVersion: string;
  requirementId: string | null;
  latencyMs: number;
  attempts: number;
  success: boolean;
  errorKind: LlmErrorKind | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LLM_LOG_FILE = process.env.LLM_LOG_FILE ?? join(ROOT, "experiments", "logs", "llm-calls.jsonl");

export function writeCallLog(entry: LlmCallLog): void {
  if (process.env.LLM_LOG_DISABLED === "1") return;
  mkdirSync(dirname(LLM_LOG_FILE), { recursive: true });
  appendFileSync(LLM_LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
}

// Parses model text as JSON and validates it; returns a readable error for the repair prompt.
export function parseAndValidate<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON (${(e as Error).message})` };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}

export function repairInstruction(previousOutput: string, error: string): string {
  return [
    "Your previous answer could not be used because it did not match the required JSON schema.",
    `Problem: ${error}`,
    "Previous answer:",
    previousOutput.slice(0, 4000),
    "Return the corrected answer as JSON only, matching the schema exactly. Do not add fields.",
  ].join("\n");
}
