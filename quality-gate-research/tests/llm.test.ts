import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const LOG = join(tmpdir(), `qg-llm-test-${process.pid}.jsonl`);
process.env.LLM_LOG_FILE = LOG;

const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { AnthropicProvider } = await import("../src/llm/anthropicProvider.ts");
const { LlmError } = await import("../src/llm/provider.ts");
const { AnalysisSchema } = await import("../src/llm/schemas.ts");

type Reply = { text?: string; stop_reason?: string; model?: string; throws?: unknown; category?: string };

// Minimal stand-in for the SDK client: returns scripted responses and records requests.
function fakeClient(replies: Reply[]) {
  const requests: any[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: any) => {
          requests.push(structuredClone(params));
          const r = replies.shift()!;
          if (r.throws) throw r.throws;
          return {
            model: r.model ?? "claude-opus-5-5",
            stop_reason: r.stop_reason ?? "end_turn",
            stop_details: r.stop_reason === "refusal" ? { type: "refusal", category: r.category ?? "cyber", explanation: "" } : null,
            content: r.text === undefined ? [] : [{ type: "text", text: r.text }],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    },
  };
  return { client: client as unknown as InstanceType<typeof Anthropic>, requests };
}

const req = { task: "analyze" as const, promptVersion: "test", requirementId: "R1", system: "s", user: "u", schema: AnalysisSchema };
const VALID = JSON.stringify({ status: "CLEAR", issues: [] });
const lastLog = () => JSON.parse(readFileSync(LOG, "utf8").trim().split("\n").at(-1)!);

test("valid JSON on first attempt; request uses fixed model, effort, schema and default fallbacks", async () => {
  const { client, requests } = fakeClient([{ text: VALID }]);
  const out = await new AnthropicProvider({ client, effort: "medium" }).completeJson(req);
  assert.deepEqual(out, { status: "CLEAR", issues: [] });
  assert.equal(requests[0].model, "claude-opus-5-5");
  assert.equal(requests[0].output_config.effort, "medium");
  assert.equal(requests[0].output_config.format.type, "json_schema");
  assert.equal(requests[0].fallbacks, "default");
  assert.equal(requests[0].temperature, undefined, "sampling params are rejected by this model");
  const log = lastLog();
  assert.equal(log.success, true);
  assert.equal(log.attempts, 1);
  assert.equal(log.promptVersion, "test");
  assert.ok(!JSON.stringify(log).includes("sk-ant"), "no secrets in logs");
});

test("invalid JSON is retried once with a repair instruction, appended to the history", async () => {
  const { client, requests } = fakeClient([{ text: '{"status":"MAYBE"}' }, { text: VALID }]);
  const out = await new AnthropicProvider({ client }).completeJson(req);
  assert.equal(out.status, "CLEAR");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.length, 3);
  assert.match(requests[1].messages[2].content, /did not match the required JSON schema/);
  assert.equal(lastLog().attempts, 2);
});

test("still invalid after repair -> controlled LlmError, no fabricated result", async () => {
  const { client } = fakeClient([{ text: "not json" }, { text: "still not json" }]);
  await assert.rejects(new AnthropicProvider({ client }).completeJson(req), (e: any) => e instanceof LlmError && e.kind === "invalid_json");
  assert.equal(lastLog().success, false);
});

test("refusal stop reason is checked before reading content", async () => {
  const { client } = fakeClient([{ stop_reason: "refusal", category: "cyber" }]);
  await assert.rejects(new AnthropicProvider({ client }).completeJson(req), (e: any) => e.kind === "refusal" && /cyber/.test(e.message));
});

test("network failure becomes a controlled error instead of a crash", async () => {
  const { client } = fakeClient([{ throws: new Anthropic.APIConnectionError({ message: "offline" }) }]);
  await assert.rejects(new AnthropicProvider({ client }).completeJson(req), (e: any) => e.kind === "network");
});

test("a response served by a fallback model is logged with servedModel", async () => {
  const { client } = fakeClient([{ text: VALID, model: "claude-opus-4-8" }]);
  await new AnthropicProvider({ client }).completeJson(req);
  const log = lastLog();
  assert.equal(log.model, "claude-opus-5-5");
  assert.equal(log.servedModel, "claude-opus-4-8");
});

test.after(() => rmSync(LOG, { force: true }));
