import { parseAndValidate, LlmError, writeCallLog, type JsonRequest, type LlmProvider } from "./provider.ts";

// Deterministic stand-in for an LLM, used by unit tests and offline smoke runs. It exercises the
// same JSON validation path as the real provider, but its "analysis" is a crude heuristic.
// Results produced with the mock MUST NOT be reported as experimental results.

const ACTORS = ["user", "driver", "operator", "customer", "administrator", "admin", "staff", "supervisor", "auditor", "investigator", "player", "shunting leader", "signaller"];
const CONDITION_WORDS = ["stationary", "moving", "only", "not", "never", "below", "above", "standstill"];

function field(user: string, label: string): string {
  return user.split("\n").find((l) => l.startsWith(label))?.slice(label.length).trim() ?? "";
}

function contentWords(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z]{5,}/g) ?? []);
}

function analyze(user: string) {
  const text = field(user, "Requirement text:");
  const diagram = field(user, "Target diagram:");
  const hasContext = !/Context:\n\(none\)/.test(user);
  const issues: object[] = [];
  for (const line of user.split("\n")) {
    const m = line.match(/^- (\S+) \((\w+)\) span="([^"]*)"/);
    if (!m) continue;
    const [, ruleId, , span] = m;
    if (ruleId === "AMB-PRON-001" && hasContext) continue; // assume the context resolves the referent
    const type = ruleId.startsWith("INC") ? "INCOMPLETENESS" : "AMBIGUITY";
    issues.push({ type, span, reason: `Rule ${ruleId} flagged "${span}".`, question: `What exactly does "${span}" mean here?`, relatedRequirementIds: [] });
  }
  if (diagram === "USE_CASE" && !ACTORS.some((a) => text.toLowerCase().includes(a))) {
    issues.push({ type: "INCOMPLETENESS", span: null, reason: "No actor is named.", question: "Which actor performs this?", relatedRequirementIds: [] });
  }
  return { status: issues.length ? "NEEDS_CLARIFICATION" : "CLEAR", issues };
}

function consistency(user: string) {
  const lines = user.split("\n");
  const main = lines[0].replace(/^Requirement [^:]+: /, "");
  const issues: object[] = [];
  for (const line of lines.slice(2)) {
    const m = line.match(/^- ([^:]+): (.*)$/);
    if (!m) continue;
    const shared = [...contentWords(main)].filter((w) => contentWords(m[2]).has(w));
    const differentConditions = CONDITION_WORDS.some((w) => main.toLowerCase().includes(w) !== m[2].toLowerCase().includes(w));
    if (shared.length >= 3 && differentConditions) {
      issues.push({ type: "POTENTIAL_INCONSISTENCY", span: null, reason: `Same subject (${shared.slice(0, 3).join(", ")}) under different conditions.`, question: `Which condition applies when ${m[1]} and this requirement overlap?`, relatedRequirementIds: [m[1]] });
    }
  }
  return { status: issues.length ? "NEEDS_CLARIFICATION" : "CLEAR", issues };
}

function rewrite(user: string) {
  let text = field(user, "Original requirement:");
  const used: string[] = [];
  for (const line of user.split("\n")) {
    const m = line.match(/^- (\S+) \| Q: (.*) \| A: (.*)$/);
    if (!m) continue;
    const span = m[2].match(/"([^"]+)"/)?.[1];
    if (span && text.includes(span)) text = text.replace(span, m[3]);
    else text = `${text.replace(/\.$/, "")}; ${m[3]}.`;
    used.push(m[1]);
  }
  return { rewrittenText: text.replace(/\bshould\b/g, "shall"), usedAnswerIds: used };
}

function uml(user: string) {
  const text = field(user, "Requirement:").toLowerCase();
  const diagram = field(user, "Diagram type:");
  const actors = ACTORS.filter((a) => text.includes(a));
  const verbPhrase = text.match(/shall (?:be able to )?([a-z]+(?: [a-z]+){0,3})/)?.[1] ?? "";
  const nouns = [...new Set(text.match(/\b(?:the|a|an|each) ([a-z]+)/g)?.map((n) => n.split(" ")[1]) ?? [])].filter((n) => !actors.includes(n));
  const base = { actors: [] as string[], classes: [] as string[], useCases: [] as string[], operations: [] as string[], relationships: [] as object[], messages: [] as object[] };
  if (diagram === "USE_CASE") {
    base.actors = actors.length ? actors : ["user"];
    if (verbPhrase) base.useCases = [verbPhrase];
    base.relationships = base.useCases.map((u) => ({ from: base.actors[0], to: u, type: "association" }));
  } else if (diagram === "CLASS") {
    base.classes = nouns.slice(0, 3);
    if (verbPhrase) base.operations = [verbPhrase.split(" ")[0]];
    if (base.classes.length > 1) base.relationships = [{ from: base.classes[0], to: base.classes[1], type: "association" }];
  } else {
    base.actors = actors;
    base.classes = ["system", ...nouns.slice(0, 1)];
    const from = actors[0] ?? "system";
    if (verbPhrase) base.messages = [{ from, to: from === "system" ? base.classes[1] ?? "system" : "system", name: verbPhrase.split(" ")[0] }];
  }
  return base;
}

export class MockProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock-heuristic";
  readonly effort = "n/a";

  async completeJson<T>(req: JsonRequest<T>): Promise<T> {
    const started = Date.now();
    const output =
      req.task === "consistency" ? consistency(req.user) : req.task === "rewrite" ? rewrite(req.user) : req.task === "uml" ? uml(req.user) : analyze(req.user);
    const parsed = parseAndValidate(JSON.stringify(output), req.schema);
    writeCallLog({
      timestamp: new Date().toISOString(),
      provider: this.name,
      model: this.model,
      servedModel: this.model,
      effort: this.effort,
      task: req.task,
      promptVersion: req.promptVersion,
      requirementId: req.requirementId ?? null,
      latencyMs: Date.now() - started,
      attempts: 1,
      success: parsed.ok,
      errorKind: parsed.ok ? null : "invalid_json",
      inputTokens: null,
      outputTokens: null,
    });
    if (!parsed.ok) throw new LlmError("invalid_json", req.task, parsed.error);
    return parsed.value;
  }
}
