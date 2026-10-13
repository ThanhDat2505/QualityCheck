import { readFileSync } from "node:fs";
import { DIAGRAM_TYPES, type DiagramType, type GoldLabel, type RequirementInput } from "../types/qualityGate.ts";

// RFC-4180 CSV reader (quoted fields, doubled quotes, CRLF). Returns rows as header-keyed records.
export function readCsv(path: string): Record<string, string>[] {
  const s = readFileSync(path, "utf8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export interface DatasetRow {
  input: RequirementInput;
  sourceDocument: string;
  sampling: string;
  raw: Record<string, string>;
}

// Loads requirements.csv / smoke.csv into Gate inputs. Context = the neighbouring sentences;
// related requirements are resolved to their text from the same file.
export function loadDataset(path: string): DatasetRow[] {
  const records = readCsv(path);
  const textById = new Map(records.map((r) => [r.requirement_id, r.requirement_text]));
  return records.map((r) => {
    if (!DIAGRAM_TYPES.includes(r.target_diagram as DiagramType)) throw new Error(`${path}: ${r.requirement_id} has invalid target_diagram "${r.target_diagram}"`);
    const related = (r.related_requirement_ids ?? "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((id) => {
        const text = textById.get(id);
        if (!text) throw new Error(`${path}: ${r.requirement_id} refers to unknown ${id}`);
        return { id, text };
      });
    const context = [r.context_before, r.context_after].filter((c) => c && c.trim());
    return {
      input: {
        id: r.requirement_id,
        text: r.requirement_text,
        targetDiagram: r.target_diagram as DiagramType,
        ...(context.length ? { context } : {}),
        ...(related.length ? { relatedRequirements: related } : {}),
      },
      sourceDocument: r.source_document ?? "",
      sampling: r.sampling ?? "",
      raw: r,
    };
  });
}

// gold.csv (or smoke.csv expected_label) -> label per requirement id.
export function loadGold(path: string, column = "label"): Map<string, GoldLabel> {
  return new Map(readCsv(path).map((r) => [r.requirement_id, r[column] as GoldLabel]));
}
