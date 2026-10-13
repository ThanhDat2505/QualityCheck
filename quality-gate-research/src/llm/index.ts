import { AnthropicProvider } from "./anthropicProvider.ts";
import { MockProvider } from "./mockProvider.ts";
import type { LlmProvider } from "./provider.ts";

// LLM_PROVIDER=anthropic (default when credentials exist) or mock (offline, tests, smoke).
export function createProvider(name = process.env.LLM_PROVIDER): LlmProvider {
  if (name === "mock") return new MockProvider();
  if (name === undefined || name === "anthropic") return new AnthropicProvider();
  throw new Error(`Unknown LLM_PROVIDER: ${name}`);
}
