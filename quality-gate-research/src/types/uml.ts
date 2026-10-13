// Normalized UML format shared by the generator adapter, reference models and metrics (plan M5.3).
import type { DiagramType } from "./qualityGate.ts";

export interface UmlRelationship {
  from: string;
  to: string;
  type: string;
}

export interface UmlMessage {
  from: string;
  to: string;
  name: string;
}

export interface NormalizedUmlModel {
  actors: string[];
  classes: string[];
  useCases: string[];
  operations: string[];
  relationships: UmlRelationship[];
  messages: UmlMessage[];
}

export interface UmlGenerator {
  readonly id: string; // recorded with every result so baseline and treatment can be checked for equality
  generate(requirementText: string, diagramType: DiagramType, requirementId?: string): Promise<NormalizedUmlModel>;
}

export const EMPTY_UML: NormalizedUmlModel = { actors: [], classes: [], useCases: [], operations: [], relationships: [], messages: [] };

// Which parts of the model are scored for each diagram type ("only use fields relevant to the diagram").
export const SCORED_FIELDS: Record<DiagramType, (keyof NormalizedUmlModel)[]> = {
  USE_CASE: ["actors", "useCases", "relationships"],
  CLASS: ["classes", "operations", "relationships"],
  SEQUENCE: ["actors", "classes", "messages"],
};
