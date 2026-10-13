import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LlmError, parseAndValidate, repairInstruction, writeCallLog, type JsonRequest, type LlmProvider } from "./provider.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Claude via the official SDK. Reproducibility notes:
// - claude-opus-5-5 rejects temperature/top_p, so determinism comes from a fixed model id, a fixed
//   effort level, versioned prompts and logging every call; outputs are stored, never regenerated.
// - fallbacks: "default" lets the API re-run a safety-declined request on another model. Such calls
//   are logged with servedModel != model so the experiment can flag them.
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  readonly effort: Effort;
  private readonly client: Anthropic;

  constructor(opts: { model?: string; effort?: Effort; client?: Anthropic } = {}) {
    this.model = opts.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;
    this.effort = opts.effort ?? (process.env.LLM_EFFORT as Effort | undefined) ?? "medium";
    this.client = opts.client ?? new Anthropic(); // credentials from ANTHROPIC_API_KEY / ant profile
  }

  async completeJson<T>(req: JsonRequest<T>): Promise<T> {
    const started = Date.now();
    const jsonSchema = z.toJSONSchema(req.schema) as Record<string, unknown>;
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: req.user }];
    let attempts = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let servedModel: string | null = null;
    const log = (success: boolean, errorKind: LlmError["kind"] | null) =>
      writeCallLog({
        timestamp: new Date().toISOString(),
        provider: this.name,
        model: this.model,
        servedModel,
        effort: this.effort,
        task: req.task,
        promptVersion: req.promptVersion,
        requirementId: req.requirementId ?? null,
        latencyMs: Date.now() - started,
        attempts,
        success,
        errorKind,
        inputTokens,
        outputTokens,
      });

    // One normal attempt plus one repair attempt (plan M3.2).
    while (attempts < 2) {
      attempts++;
      let response: Anthropic.Beta.Messages.BetaMessage;
      try {
        response = await this.client.beta.messages.create({
          model: this.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: req.system,
          messages,
          output_config: { effort: this.effort, format: { type: "json_schema", schema: jsonSchema } },
        });
      } catch (error) {
        const kind = error instanceof Anthropic.APIConnectionError ? "network" : "api";
        log(false, kind);
        throw new LlmError(kind, req.task, error instanceof Error ? error.message : String(error));
      }
      servedModel = response.model;
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      if (response.stop_reason === "refusal") {
        log(false, "refusal");
        throw new LlmError("refusal", req.task, response.stop_details?.category ?? "declined");
      }
      if (response.stop_reason === "max_tokens") {
        log(false, "truncated");
        throw new LlmError("truncated", req.task, "output hit max_tokens");
      }
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const parsed = parseAndValidate(text, req.schema);
      if (parsed.ok) {
        log(true, null);
        return parsed.value;
      }
      if (attempts >= 2) {
        log(false, "invalid_json");
        throw new LlmError("invalid_json", req.task, parsed.error);
      }
      // Append-only history: keep the failed answer and ask for a repair.
      messages.push({ role: "assistant", content: response.content }, { role: "user", content: repairInstruction(text, parsed.error) });
    }
    throw new LlmError("invalid_json", req.task, "unreachable");
  }
}
