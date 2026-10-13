import type { LlmProvider } from "../llm/provider.ts";
import { UmlSchema } from "../llm/schemas.ts";
import type { DiagramType } from "../types/qualityGate.ts";
import { SCORED_FIELDS, type NormalizedUmlModel, type UmlGenerator } from "../types/uml.ts";
import { normalizeModel } from "./normalize.ts";

// Decision record (plan M5.1): the original requirement-to-UML implementation from the paper was
// not available to the team, so the experiment uses this fixed substitute generator for BOTH
// baseline and treatment. Results are a prototype/replication adaptation, not a reproduction.
// Any change to UML_PROMPT_VERSION, the model or the effort changes the generator id and invalidates comparisons.
export const UML_PROMPT_VERSION = "uml-v0.1";

const UML_SYSTEM = `You convert one software requirement into elements of a UML diagram.
Model only what the requirement states. Do not invent actors, classes, operations, messages or relationships
that the text does not mention; if something is missing, leave it out.
Use short names exactly as worded in the requirement (nouns for actors and classes, verb phrases for use cases,
operations and messages). Fill only the fields that belong to the requested diagram type and leave the others empty:
- USE_CASE: actors, useCases, relationships (actor -> use case, type "association"; use case -> use case, type "include" or "extend")
- CLASS: classes, operations (as "Class.operation"), relationships (type "association", "composition", "aggregation" or "generalization")
- SEQUENCE: actors and classes as participants, messages (from, to, name) in the order they occur
Return only the JSON object required by the schema.`;

export class LlmUmlGenerator implements UmlGenerator {
  readonly id: string;
  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider) {
    this.provider = provider;
    this.id = `llm-uml:${provider.name}:${provider.model}:${provider.effort}:${UML_PROMPT_VERSION}`;
  }

  async generate(requirementText: string, diagramType: DiagramType, requirementId?: string): Promise<NormalizedUmlModel> {
    const raw = await this.provider.completeJson({
      task: "uml",
      promptVersion: UML_PROMPT_VERSION,
      requirementId,
      system: UML_SYSTEM,
      user: `Diagram type: ${diagramType}\nRequirement: ${requirementText}`,
      schema: UmlSchema,
    });
    return restrictToDiagram(normalizeModel(raw), diagramType);
  }
}

// Fields that do not belong to the diagram are cleared so they can never be scored.
export function restrictToDiagram(m: NormalizedUmlModel, d: DiagramType): NormalizedUmlModel {
  const keep = new Set(SCORED_FIELDS[d]);
  return {
    actors: keep.has("actors") ? m.actors : [],
    classes: keep.has("classes") ? m.classes : [],
    useCases: keep.has("useCases") ? m.useCases : [],
    operations: keep.has("operations") ? m.operations : [],
    relationships: keep.has("relationships") ? m.relationships : [],
    messages: keep.has("messages") ? m.messages : [],
  };
}
