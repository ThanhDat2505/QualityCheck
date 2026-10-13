import type { NormalizedUmlModel } from "../types/uml.ts";

export const NORMALIZATION_VERSION = "v0.1";

// Canonical form of an element name so that "AuditTrail", "audit_trail" and "Audit trails" compare equal.
// Rules (documented in docs/experiment-protocol.md): split camelCase and snake/kebab case, lower-case,
// drop punctuation and leading articles, singularise the last word.
export function normalizeName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && ["the", "a", "an"].includes(words[0])) words.shift();
  if (words.length) words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(" ");
}

function singular(w: string): string {
  if (w.length <= 3 || w.endsWith("ss") || w.endsWith("us") || w.endsWith("is")) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|xes|ses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

const unique = (xs: string[]) => [...new Set(xs.map(normalizeName).filter(Boolean))].sort();

export function normalizeModel(m: NormalizedUmlModel): NormalizedUmlModel {
  const rel = new Map(m.relationships.map((r) => [`${normalizeName(r.from)}|${normalizeName(r.to)}|${normalizeName(r.type)}`, r]));
  const msg = new Map(m.messages.map((r) => [`${normalizeName(r.from)}|${normalizeName(r.to)}|${normalizeName(r.name)}`, r]));
  return {
    actors: unique(m.actors),
    classes: unique(m.classes),
    useCases: unique(m.useCases),
    operations: unique(m.operations),
    relationships: [...rel.keys()].sort().map((k) => {
      const [from, to, type] = k.split("|");
      return { from, to, type };
    }),
    messages: [...msg.keys()].sort().map((k) => {
      const [from, to, name] = k.split("|");
      return { from, to, name };
    }),
  };
}
