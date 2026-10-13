// Build data/sampled/requirements.csv from the PURE XML documents in data/raw/XMLZIPFile.
// Run: node scripts/build-requirements.ts   (Node >= 23.6, no dependencies)
//
// Steps (see docs plan, M1.1–M1.3, M1.8):
//   1. Parse each XML document and walk it in document order, tracking the current section.
//   2. Extract candidate requirements:
//        - documents with <req> tags  -> each <req> is one candidate (source_req_id = req id)
//        - documents without <req>    -> sentences containing a requirement modal (shall/must/should, ...)
//   3. Filter (length, meta statements about the document itself) and de-duplicate.
//   4. Deterministically sample ~120 candidates across all documents, in small same-section clusters.
//      Pairs listed in pinned-pairs.csv (deliberately chosen potential-inconsistency pairs) are always
//      included and count toward their document's quota; they are marked sampling = PINNED_PAIR.
//   5. Assign a heuristic target_diagram, write requirements.csv + annotation-template.csv, print QA stats.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "data", "raw", "XMLZIPFile");
const OUT_REQUIREMENTS = join(ROOT, "data", "sampled", "requirements.csv");
const OVERRIDES = join(ROOT, "data", "sampled", "target-diagram-overrides.csv");
const SMOKE = join(ROOT, "data", "fixtures", "smoke.csv");
const PINNED = join(ROOT, "data", "sampled", "pinned-pairs.csv");
const OUT_ALL = join(ROOT, "data", "sampled", "candidates-all.csv");
const OUT_TEMPLATE = join(ROOT, "data", "annotations", "annotation-template.csv");
const OUT_PILOT = join(ROOT, "data", "pilot", "pilot.csv");

const SEED = 392;
const TARGET_SAMPLE = 120;
// Documents kept in data/raw but excluded from sampling (team decision, see data/sampled/review-notes.md):
// peering = use-case pre/post-conditions, not requirements; get real = informal student document;
// peppol = legal/organisational analysis, almost no system requirements.
const EXCLUDED_DOCS = ["2008 - peering.xml", "2007 - get real 0.2.xml", "2009 - peppol approved.xml"];
const BASE_QUOTA = 7;
const MAX_QUOTA = 10;
const MIN_WORDS = 5;
const MAX_WORDS = 70;
const CONTEXT_MAX_CHARS = 300;

// ---------- minimal XML parser (input files are well-formed) ----------

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[6] !== undefined) top.children.push(decodeEntities(m[6]));
    else if (m[3]) {
      if (m[2] === "/") {
        stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? "");
      }
      const node: XmlNode = { tag: m[3], attrs, children: [] };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    }
  }
  return root;
}

function textOf(node: XmlNode | string, skip: Set<string> = new Set()): string {
  if (typeof node === "string") return node;
  if (skip.has(node.tag)) return "";
  return node.children.map((c) => textOf(c, skip)).join(" ");
}

// PDF-to-XML conversion left typographic ligatures (e.g. "efﬁcient"); expand them, nothing else is changed.
const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl" };
const clean = (s: string) => s.replace(/[ﬀ-ﬄ]/g, (c) => LIGATURES[c]).replace(/\s+/g, " ").trim();

// ---------- walk documents into ordered text blocks ----------

interface Block {
  text: string;
  section: string;
  reqId?: string; // set when the block is a tagged <req>
}

function collectBlocks(doc: XmlNode): Block[] {
  const blocks: Block[] = [];
  const LIST_TAGS = new Set(["itemize", "enum"]);

  function visit(node: XmlNode, section: string) {
    for (const child of node.children) {
      if (typeof child === "string") continue;
      switch (child.tag) {
        case "p": {
          const titleNode = child.children.find((c) => typeof c !== "string" && c.tag === "title");
          const title = titleNode ? clean(textOf(titleNode)) : "";
          const id = child.attrs.id ?? "";
          visit(child, clean(`${id} ${title}`) || section);
          break;
        }
        case "req":
          blocks.push({ text: clean(textOf(child, new Set(["modifier"]))), section, reqId: child.attrs.id ?? "" });
          break;
        case "text_body":
          blocks.push({ text: clean(textOf(child, LIST_TAGS)), section });
          visit(child, section);
          break;
        case "item":
          blocks.push({ text: clean(textOf(child, LIST_TAGS)), section });
          visit(child, section);
          break;
        case "title":
        case "glossary":
        case "version":
        case "issue_date":
        case "file_number":
        case "change_log":
          break;
        default:
          visit(child, section);
      }
    }
  }

  visit(doc, "");
  return blocks.filter((b) => b.text.length > 0);
}

// ---------- candidate extraction ----------

interface Candidate {
  doc: string;
  section: string;
  reqId: string;
  text: string;
  before: string;
  after: string;
  order: number;
}

const STRONG_MODAL = /\b(shall|must|should|is required to|are required to|has to|have to)\b/i;
const WEAK_MODAL = /\b(will|can)\b/i;
// Statements about the document itself, leftover IEEE-template guidance and author notes.
const META = /\b(this (document|section|chapter|srs|specification|appendix)|the (reader|srs)|this software requirements specification|is organi[sz]ed|refer to (section|appendix)|described in (section|chapter)|I think|these may include)\b/i;
const TEMPLATE_INSTRUCTION = /^["“”'\s]*(Identify|Describe|List|Specify|Refer)\b/;
// Lead-ins whose list items live in separate elements, e.g. "... shall capture the following information:",
// "... in the form of:" or any sentence ending with a colon (optionally followed by an EIRENE marker).
const DANGLING_LIST = /(\bfollowing\b[^.;]*[:.]?|:)\s*(\([MOI]\))?\s*$/i;
// A section heading absorbed into the text: a sentence end followed by two or more Capitalised Words and
// then another sentence start without punctuation, e.g. "... only accessible Reliability and availability A measure ...".
const ABSORBED_HEADING = /[a-z]\s+[A-Z][a-z]+(?:\s+(?:and|of|or)\s+[a-z]+|\s+[A-Z][a-z]+){0,3}\s+(?:A|An|The|This|These|It)\s+[a-z]/;
// A list-item label glued to the front of the sentence, e.g. "Monitor level Each subsystem should ...".
const LEADING_LABEL = /^[A-Z][a-z]+(?:\s+[a-z]+){0,2}\s+(?:A|An|The|This|These|It|Each|All|Every)\s+[a-z]/;
// An all-caps section heading glued to the front, e.g. "EXTERNAL INTERFACE REQUIREMENTS It should ...".
const LEADING_CAPS_HEADING = /^(?:[A-Z]{2,}(?:\s+|$)){2,}/;
// Introductory sections rarely contain requirements, only scope/background prose.
const SKIP_SECTION = /\b(purpose|scope|references|overview|document conventions|intended audience|product perspective|user classes|definitions|acronyms|abbreviations|glossary|appendix)\b/i;
// EIRENE marks clauses as (M)andatory, (O)ptional or (I)nformative; informative clauses are not requirements.
const INFORMATIVE = /\(I\)/;
// Requirement labels that precede the wording in some sources (kept in source_req_id, not in the text).
const SSS_MARKER = /\s*\[(SSS\d+)\]/;
const LABEL_PREFIX = /^((Measurement|Specialization|Relationship)\s+)*Requirement\s+(?=[A-Z])/;

// Sentence boundaries: end punctuation followed by a capital. Boundaries inside a pair of straight
// double quotes are ignored, so quoted UI text such as "You win ! Enter your name : " stays in one unit.
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (/[.!?;]/.test(text[i]) && /^\s+[A-Z“(]/.test(text.slice(i + 1, i + 4))) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map(clean).filter(Boolean);
}

// TCS ends every requirement with an [SSSnnn] tag: split on it so each tagged requirement is one unit.
function splitUnits(text: string): { text: string; reqId?: string }[] {
  if (!SSS_MARKER.test(text)) return splitSentences(text).map((s) => ({ text: s }));
  const parts = text.split(new RegExp(SSS_MARKER.source, "g"));
  const units: { text: string; reqId?: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = clean(parts[i]);
    if (body) units.push({ text: body, reqId: parts[i + 1] });
  }
  return units;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function isUsable(text: string, section: string): boolean {
  const n = wordCount(text);
  if (n < MIN_WORDS || n > MAX_WORDS) return false;
  if (META.test(text) || TEMPLATE_INSTRUCTION.test(text) || DANGLING_LIST.test(text) || INFORMATIVE.test(text)) return false;
  if (ABSORBED_HEADING.test(text) || LEADING_LABEL.test(text)) return false;
  if (SKIP_SECTION.test(section)) return false;
  if (!/[a-z]/.test(text)) return false; // all caps headers / table junk
  if (text.startsWith("(")) return false; // sentence split inside a citation, e.g. "(cf. subsection ..."
  return true;
}

// Removes labels around the wording without touching the wording itself:
// leading "REQ-n:" / clause number equal to the req id / "Requirement" table label,
// and a short sub-heading that leaked in after a final (M)/(O) marker.
function stripLabels(text: string, reqId: string): { text: string; reqId: string } {
  let t = text;
  const label = t.match(/^(REQ-\d+)\s*:\s*/i);
  if (label) {
    t = t.slice(label[0].length);
    reqId = reqId || label[1];
  }
  if (reqId && t.startsWith(reqId + " ")) t = t.slice(reqId.length).trimStart();
  t = t.replace(LABEL_PREFIX, "").replace(LEADING_CAPS_HEADING, "");
  // EIRENE: a sub-heading that followed the clause on the next line, e.g. "... standby 75%. Electromagnetic Compatibility".
  t = t.replace(/(\([MO]\)|[.%])\s+[A-Z][a-z]+(?: [A-Za-z]+){0,3}$/, "$1");
  return { text: clean(t), reqId };
}

const truncate = (s: string) => (s.length > CONTEXT_MAX_CHARS ? s.slice(0, CONTEXT_MAX_CHARS - 1) + "…" : s);

function extractCandidates(docName: string, blocks: Block[]): Candidate[] {
  const tagged = blocks.some((b) => b.reqId !== undefined);
  // Flatten to ordered units (sentences for untagged docs) so neighbours give context.
  const units: { text: string; section: string; reqId?: string }[] = [];
  for (const b of blocks) {
    if (tagged) {
      if (b.reqId !== undefined) units.push(b);
      else units.push({ text: b.text, section: b.section });
    } else {
      for (const s of splitUnits(b.text)) units.push({ ...s, section: b.section });
    }
  }

  // Modal is checked outside parentheses so asides like "(This should populate ...)" do not count.
  const hasModal = (re: RegExp, s: string) => re.test(s.replace(/\([^)]*\)/g, ""));
  const strongCount = units.filter((u) => hasModal(STRONG_MODAL, u.text)).length;
  const modal = strongCount >= 10 ? STRONG_MODAL : new RegExp(`${STRONG_MODAL.source}|${WEAK_MODAL.source}`, "i");

  const out: Candidate[] = [];
  units.forEach((u, i) => {
    const isReq = tagged ? u.reqId !== undefined : hasModal(modal, u.text);
    if (!isReq) return;
    const { text, reqId } = stripLabels(u.text, u.reqId ?? "");
    if (!isUsable(text, u.section)) return;
    const neighbour = (j: number) => (j >= 0 && j < units.length && units[j].section === u.section ? truncate(units[j].text) : "");
    out.push({ doc: docName, section: u.section, reqId, text, before: neighbour(i - 1), after: neighbour(i + 1), order: i });
  });

  // De-duplicate identical texts within a document (keep first occurrence).
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = c.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- deterministic sampling ----------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// One generator per document (seeded from SEED + document name) so that adding, removing or
// re-extracting one document does not change the sample drawn from the others.
let rand = mulberry32(SEED);
function seedFor(doc: string): void {
  let h = SEED;
  for (const ch of doc) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  rand = mulberry32(h);
}
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function allocateQuotas(counts: Map<string, number>): Map<string, number> {
  const quota = new Map([...counts].map(([d, n]) => [d, Math.min(n, BASE_QUOTA)]));
  let total = [...quota.values()].reduce((a, b) => a + b, 0);
  const docs = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
  let grew = true;
  while (total < TARGET_SAMPLE && grew) {
    grew = false;
    for (const d of docs) {
      if (total >= TARGET_SAMPLE) break;
      if (quota.get(d)! < Math.min(counts.get(d)!, MAX_QUOTA)) {
        quota.set(d, quota.get(d)! + 1);
        total++;
        grew = true;
      }
    }
  }
  return quota;
}

// Picks runs of 1–3 consecutive candidates from the same section so related
// requirements appear together (needed to study potential inconsistency).
function sampleDoc(cands: Candidate[], quota: number): Candidate[][] {
  seedFor(cands[0].doc);
  const bySection = new Map<string, Candidate[]>();
  for (const c of cands) {
    if (!bySection.has(c.section)) bySection.set(c.section, []);
    bySection.get(c.section)!.push(c);
  }
  const clusters: Candidate[][] = [];
  let remaining = quota;
  let sections = shuffle([...bySection.values()]);
  while (remaining > 0 && sections.length > 0) {
    const next: Candidate[][] = [];
    for (const group of sections) {
      if (remaining === 0) break;
      const k = Math.min(remaining, group.length, randInt(1, 3));
      const start = randInt(0, group.length - k);
      clusters.push(group.slice(start, start + k));
      remaining -= k;
      const rest = [...group.slice(0, start), ...group.slice(start + k)];
      if (rest.length) next.push(rest);
    }
    sections = next;
  }
  return clusters;
}

// ---------- target diagram heuristic (to be reviewed by Member 1) ----------

// SEQUENCE: an interaction between parties; CLASS: data/structure; otherwise USE_CASE (actor goal / capability).
const SEQUENCE_CUES = /\b(send|sends|sent|receive[sd]?|transmit(s|ted)?|forward(s|ed)?|notif(y|ies|ied|ication)|request(s|ed)?|respond(s|ed)?|response|repl(y|ies|ied)|messages?|signal(s|led|ling)?|communicat(e|es|ed|ion|ions)|exchanged?|interface with|connects? to|acknowledge[sd]?|inform(s|ed)?|alerts?|quer(y|ies|ied)|calls?|routing)\b/i;
const CLASS_CUES = /\b(store[sd]?|recorded|be recorded|maintain(s|ed)?|contains?|consists? of|composed of|attributes?|fields?|data (item|element|field)s?|associated with|linked to|link(s|ed)? between|properties|each \w+ (shall |must |should )?(have|has|contain))\b/i;

type DiagramType = "USE_CASE" | "CLASS" | "SEQUENCE";

function heuristicDiagram(text: string): DiagramType {
  if (SEQUENCE_CUES.test(text)) return "SEQUENCE";
  if (CLASS_CUES.test(text)) return "CLASS";
  return "USE_CASE";
}

// Manual decisions (Member 1) live in target-diagram-overrides.csv so that a rebuild keeps them.
function loadOverrides(): Map<string, DiagramType> {
  const out = new Map<string, DiagramType>();
  if (!existsSync(OVERRIDES)) return out;
  for (const line of readFileSync(OVERRIDES, "utf8").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [id, diagram] = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (!["USE_CASE", "CLASS", "SEQUENCE"].includes(diagram)) throw new Error(`${OVERRIDES}: bad diagram for ${id}`);
    out.set(id, diagram as DiagramType);
  }
  return out;
}

// ---------- CSV ----------

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
const csvRow = (cells: string[]) => cells.map(csvCell).join(",");

// ---------- main ----------

const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".xml")).sort();
const allCandidates: Candidate[] = [];
for (const f of files) {
  const doc = parseXml(readFileSync(join(RAW_DIR, f), "utf8"));
  allCandidates.push(...extractCandidates(f, collectBlocks(doc)));
}

// Texts used as smoke fixtures must not appear in the evaluation sample.
function loadSmokeTexts(): Set<string> {
  if (!existsSync(SMOKE)) return new Set();
  const cells = readFileSync(SMOKE, "utf8").match(/"(?:[^"]|"")*"/g) ?? [];
  return new Set(cells.map((c) => c.slice(1, -1).replace(/""/g, '"')));
}
const smokeTexts = loadSmokeTexts();

// Deliberately chosen pairs (potential inconsistency). Each row is matched by the start of its text, plus
// source_req_id when given (ids such as REQ-6 repeat across sections); exactly one candidate must match.
interface Pin {
  pairId: string;
  candidate: Candidate;
}
function loadPinned(candidates: Candidate[]): Pin[] {
  if (!existsSync(PINNED)) return [];
  const pins: Pin[] = [];
  for (const line of readFileSync(PINNED, "utf8").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [pairId, doc, reqId, prefix] = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const hits = candidates.filter((c) => c.doc === doc && c.text.startsWith(prefix) && (!reqId || c.reqId === reqId));
    if (hits.length !== 1) throw new Error(`${PINNED}: ${pairId} "${prefix}" matched ${hits.length} candidates in ${doc}`);
    pins.push({ pairId, candidate: hits[0] });
  }
  return pins;
}
const pinned = loadPinned(allCandidates.filter((c) => !EXCLUDED_DOCS.includes(c.doc) && !smokeTexts.has(c.text)));
const pinnedTexts = new Set(pinned.map((p) => p.candidate.text));

const byDoc = new Map<string, Candidate[]>();
for (const c of allCandidates) {
  if (EXCLUDED_DOCS.includes(c.doc) || smokeTexts.has(c.text) || pinnedTexts.has(c.text)) continue;
  if (!byDoc.has(c.doc)) byDoc.set(c.doc, []);
  byDoc.get(c.doc)!.push(c);
}
for (const p of pinned) if (!byDoc.has(p.candidate.doc)) byDoc.set(p.candidate.doc, []);
const pinnedCount = (doc: string) => pinned.filter((p) => p.candidate.doc === doc).length;
const quotas = allocateQuotas(new Map([...byDoc].map(([d, cs]) => [d, cs.length + pinnedCount(d)])));

type Row = Candidate & { id: string; related: string[]; sampling: "RANDOM" | "PINNED_PAIR" };
const rows: Row[] = [];
for (const doc of [...byDoc.keys()].sort()) {
  const randomQuota = quotas.get(doc)! - pinnedCount(doc);
  const clusters: { cands: Candidate[]; pairId?: string }[] = [
    ...pinned.filter((p) => p.candidate.doc === doc).map((p) => ({ cands: [p.candidate], pairId: p.pairId })),
    ...(randomQuota > 0 ? sampleDoc(byDoc.get(doc)!, randomQuota) : []).map((cl) => ({ cands: [...cl].sort((a, b) => a.order - b.order) })),
  ].sort((a, b) => a.cands[0].order - b.cands[0].order);
  for (const cl of clusters) {
    const ids = cl.cands.map((_, i) => `R${String(rows.length + i + 1).padStart(3, "0")}`);
    cl.cands.forEach((c, i) =>
      rows.push({ ...c, id: ids[i], related: ids.filter((x) => x !== ids[i]), sampling: cl.pairId ? "PINNED_PAIR" : "RANDOM" }),
    );
  }
}
// A pinned row's related ids are the other rows of its pair (usually a different section).
for (const p of pinned) {
  const row = rows.find((r) => r.text === p.candidate.text && r.doc === p.candidate.doc)!;
  row.related = pinned
    .filter((q) => q.pairId === p.pairId && q !== p)
    .map((q) => rows.find((r) => r.text === q.candidate.text && r.doc === q.candidate.doc)!.id);
}

const HEADER = [
  "requirement_id",
  "source_document",
  "source_section",
  "source_req_id",
  "requirement_text",
  "context_before",
  "context_after",
  "related_requirement_ids",
  "target_diagram",
  "source_type",
  "sampling",
];
const overrides = loadOverrides();
for (const id of overrides.keys()) if (!rows.some((r) => r.id === id)) throw new Error(`${OVERRIDES}: unknown requirement_id ${id}`);
const targetDiagram = (r: Row) => overrides.get(r.id) ?? heuristicDiagram(r.text);

mkdirSync(dirname(OUT_REQUIREMENTS), { recursive: true });
writeFileSync(
  OUT_REQUIREMENTS,
  [csvRow(HEADER), ...rows.map((r) => csvRow([r.id, r.doc, r.section, r.reqId, r.text, r.before, r.after, r.related.join(";"), targetDiagram(r), "REAL", r.sampling]))].join("\n") + "\n",
  "utf8",
);

writeFileSync(
  OUT_ALL,
  [
    csvRow(["source_document", "source_section", "source_req_id", "requirement_text", "context_before", "context_after"]),
    ...allCandidates.map((c) => csvRow([c.doc, c.section, c.reqId, c.text, c.before, c.after])),
  ].join("\n") + "\n",
  "utf8",
);

const TEMPLATE_HEADER = ["annotator_id", "requirement_id", "label", "issue_span", "reason", "needs_clarification", "suggested_question", "confidence", "related_requirement_ids"];
mkdirSync(dirname(OUT_TEMPLATE), { recursive: true });
try {
  writeFileSync(OUT_TEMPLATE, [csvRow(TEMPLATE_HEADER), ...rows.map((r) => csvRow(["", r.id, "", "", "", "", "", "", ""]))].join("\n") + "\n", "utf8");
} catch (e) {
  // Typically the file is open in Excel; the other outputs are already written.
  console.error(`WARNING: could not write ${OUT_TEMPLATE} (${(e as NodeJS.ErrnoException).code}); close the file and rebuild.`);
}

// ---------- pilot set (plan section 9) ----------
// One requirement per included document, disjoint from the evaluation sample, smoke fixtures and pinned
// pairs. Drawn with a separate seed so it never changes the evaluation sample.
{
  const used = new Set(rows.map((r) => `${r.doc}|${r.text}`));
  const pilot: Candidate[] = [];
  for (const doc of [...byDoc.keys()].sort()) {
    seedFor(`pilot|${doc}`);
    const free = byDoc.get(doc)!.filter((c) => !used.has(`${c.doc}|${c.text}`) && c.text.split(/\s+/).length >= 8);
    if (free.length) pilot.push(free[Math.floor(rand() * free.length)]);
  }
  mkdirSync(dirname(OUT_PILOT), { recursive: true });
  writeFileSync(
    OUT_PILOT,
    [
      csvRow(HEADER),
      ...pilot.map((c, i) => csvRow([`P${String(i + 1).padStart(2, "0")}`, c.doc, c.section, c.reqId, c.text, c.before, c.after, "", heuristicDiagram(c.text), "REAL", "PILOT"])),
    ].join("\n") + "\n",
    "utf8",
  );
  console.log(`pilot:      ${pilot.length} -> ${OUT_PILOT}`);
}

// ---------- QA report (M1.8) ----------

const ids = new Set(rows.map((r) => r.id));
const problems: string[] = [];
if (ids.size !== rows.length) problems.push("duplicate requirement_id");
const texts = rows.map((r) => r.text.toLowerCase());
if (new Set(texts).size !== texts.length) problems.push("duplicate requirement_text across documents");
for (const r of rows) {
  if (!r.text) problems.push(`${r.id}: empty text`);
  if (/�|Ã.|â€/.test(r.text)) problems.push(`${r.id}: possible encoding error`);
  for (const rel of r.related) if (!ids.has(rel)) problems.push(`${r.id}: related id ${rel} missing`);
}

const count = <T,>(xs: T[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>());
const words = rows.map((r) => wordCount(r.text)).sort((a, b) => a - b);
console.log(`candidates: ${allCandidates.length} from ${files.length} documents (${EXCLUDED_DOCS.length} excluded from sampling)`);
console.log(`sampled:    ${rows.length} -> ${OUT_REQUIREMENTS}`);
console.log("per document (sampled/candidates):");
for (const d of [...byDoc.keys()].sort()) console.log(`  ${String(rows.filter((r) => r.doc === d).length).padStart(3)}/${String(byDoc.get(d)!.length).padEnd(4)} ${d}`);
console.log(`target_diagram (${overrides.size} manual overrides):`, Object.fromEntries(count(rows.map(targetDiagram))));
console.log(`words: min ${words[0]}, median ${words[Math.floor(words.length / 2)]}, max ${words[words.length - 1]}`);
console.log(`in same-section clusters: ${rows.filter((r) => r.sampling === "RANDOM" && r.related.length).length}, pinned pair rows: ${pinned.length}`);
console.log(problems.length ? `QA problems:\n  ${problems.join("\n  ")}` : "QA: OK");
