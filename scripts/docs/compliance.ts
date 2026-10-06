// P1.36: readers and checks for the compliance skeletons in docs/human/compliance/. Each check returns its problems as
// sentences, empty when every rule holds, so compliance.test.ts can show it failing on a planted defect.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ASVS_DOC = "docs/human/compliance/asvs-5-l2.md";
export const ASVS_CSV = "docs/human/compliance/asvs-5.0.csv";
export const ROPA = "docs/human/compliance/ropa.md";
export const AI_RECORD = "docs/human/compliance/ai-system-record.md";

const STATUSES = ["covered", "partial", "open", "n/a"] as const;
const STEP_ID = /^P[0-6]\.\d{2}[a-z]?$|^L\.\d{2}$/;
const TBD = "TBD (Phase 4)";

export type AsvsRow = { id: string; status: string; evidence: string };

/** One CSV field and what ends it: a comma, a line end, or the end of the text (RFC 4180 quoting, `""` inside quotes). */
const CSV_FIELD = /("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)/g;

/** The records of a CSV text, as lists of fields; a quoted field may hold commas and line breaks. */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  for (const [whole, raw = "", end = ""] of text.matchAll(CSV_FIELD)) {
    if (whole === "") break;
    record.push(raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw);
    if (end !== ",") {
      records.push(record);
      record = [];
    }
  }
  return records.filter((r) => r.some((field) => field !== ""));
}

/** The Level 1 and Level 2 requirement ids of the pinned ASVS list (its `L` column is the lowest level that needs it). */
export function csvLevelIds(text: string): string[] {
  const [header = [], ...rows] = csvRecords(text);
  const id = header.indexOf("req_id");
  const level = header.indexOf("L");
  if (id < 0 || level < 0) throw new Error("asvs-5.0.csv has no req_id or L column");
  return rows.filter((r) => r[level] === "1" || r[level] === "2").map((r) => r[id] ?? "");
}

/** The pinned hash in asvs-5-l2.md matches the CSV's bytes. */
export function pinProblems(doc: string, csv: Buffer): string[] {
  const pinned = /^- sha256: `([0-9a-f]{64})`$/m.exec(doc)?.[1];
  if (pinned === undefined) return ["asvs-5-l2.md has no sha256 line"];
  const actual = createHash("sha256").update(csv).digest("hex");
  return actual === pinned ? [] : [`asvs-5.0.csv sha256 ${actual} differs from the pinned ${pinned}`];
}

const cells = (line: string): string[] =>
  line
    .slice(1, line.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((c) => c.trim());

/** The table rows of a document as cells, separator rows left out. */
const tableRows = (doc: string): string[][] =>
  doc
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|[-| ]+\|$/.test(line))
    .map(cells);

/** The table rows of asvs-5-l2.md: `| id | requirement | status | evidence | step |`. */
export function asvsRows(doc: string): AsvsRow[] {
  return doc
    .split("\n")
    .filter((line) => /^\| V\d+\.\d+\.\d+ \|/.test(line))
    .map((line) => {
      const [id = "", , status = "", evidence = ""] = cells(line);
      return { id, status, evidence };
    });
}

/** Every pinned L1 and L2 id has exactly one row, no other id has one, and every status is known. */
export function rowsCompleteProblems(rows: AsvsRow[], ids: string[]): string[] {
  const problems: string[] = [];
  const known = new Set(ids);
  for (const id of ids) {
    const count = rows.filter((r) => r.id === id).length;
    if (count !== 1) problems.push(count === 0 ? `${id}: no row` : `${id}: ${count} rows`);
  }
  for (const row of rows) {
    if (!known.has(row.id)) problems.push(`${row.id}: not a Level 1 or 2 id of the pinned list`);
    if (!(STATUSES as readonly string[]).includes(row.status))
      problems.push(`${row.id}: status ${row.status} is not covered, partial, open or n/a`);
  }
  return problems;
}

/** The rule ids `lint:` may name: Semgrep rule ids, and the Biome rules and plugins biome.json turns on. */
export function enabledLintRules(root: string): string[] {
  const semgrep = join(root, "scripts", "lint", "semgrep");
  const ids = readdirSync(semgrep)
    .filter((f) => f.endsWith(".yml"))
    .flatMap((f) => [...readFileSync(join(semgrep, f), "utf8").matchAll(/^ {2}- id: (\S+)$/gm)].map((m) => m[1] ?? ""));
  const biome = readFileSync(join(root, "biome.json"), "utf8");
  const rules = [...biome.matchAll(/"(\w+)": (?:"(?:error|warn)"|\{ "level": "(?:error|warn)")/g)].map(
    (m) => m[1] ?? "",
  );
  const plugins = [...biome.matchAll(/"\.\/scripts\/lint\/biome\/([\w-]+)\.grit"/g)].map((m) => m[1] ?? "");
  return [...ids, ...rules, ...plugins];
}

const regexText = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A test named exactly `name` is declared in `file` (`test(...)`, `it(...)` or their `.each` forms). */
function testDeclared(root: string, value: string): string | null {
  const [file = "", name = ""] = value.split("#");
  if (!existsSync(join(root, file))) return `test ${file} does not exist`;
  const code = readFileSync(join(root, file), "utf8");
  const declared = new RegExp(`\\b(?:it|test)(?:\\.each\\([^)]*\\))?\\(\\s*["'\`]${regexText(name)}["'\`]`);
  return declared.test(code) ? null : `test ${file}#${name} is not declared in the file`;
}

/** Each evidence kind's check: null when the pointer resolves, else why not. */
const EVIDENCE: Record<string, (root: string, value: string, lint: string[]) => string | null> = {
  test: testDeclared,
  lint: (_root, value, lint) => (lint.includes(value) ? null : `lint rule ${value} is not enabled`),
  guard: (root, value) =>
    existsSync(join(root, "scripts", "guards", `${value}.ts`)) ? null : `guard scripts/guards/${value}.ts is missing`,
  doc: (root, value) => (existsSync(join(root, value)) ? null : `doc ${value} does not exist`),
  step: (_root, value) => (STEP_ID.test(value) ? null : `step ${value} is not a step id`),
};

/** Whether a row's evidence items fit its status, or why not. */
function statusProblem(status: string, items: string[]): string | null {
  const planned = (item: string) => item.startsWith("step:");
  if (status === "covered" && items.every(planned)) return "covered needs evidence that is not step:";
  if (status === "partial" && items.length === 0) return "partial needs evidence";
  if (status === "open" && !items.every(planned)) return "open allows step: evidence only";
  return null;
}

/** Why one evidence item does not resolve, or null when it does. */
function itemProblem(root: string, item: string, lint: string[]): string | null {
  const [kind = "", ...rest] = item.split(":");
  const check = EVIDENCE[kind];
  return check === undefined ? `evidence ${item} has no known kind` : check(root, rest.join(":"), lint);
}

/** One row's problems: an n/a row needs its reason; any other row's evidence must resolve and fit its status. */
function rowProblems(root: string, { status, evidence }: AsvsRow, lint: string[]): (string | null)[] {
  if (status === "n/a") return [evidence.startsWith("n/a: ") ? null : 'n/a needs a reason ("n/a: <why>")'];
  const items = [...evidence.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
  return [...items.map((item) => itemProblem(root, item, lint)), statusProblem(status, items)];
}

/** Each row's evidence fits its status, and every pointer resolves. */
export function evidenceProblems(root: string, rows: AsvsRow[], lint: string[]): string[] {
  return rows.flatMap((row) =>
    rowProblems(root, row, lint)
      .filter((problem) => problem !== null)
      .map((problem) => `${row.id}: ${problem}`),
  );
}

/** Under STRICT=1 (launch gate L.03) no row may still be open or partial. */
export function strictProblems(rows: AsvsRow[]): string[] {
  return rows.filter((r) => r.status === "open" || r.status === "partial").map((r) => `${r.id} is ${r.status}`);
}

/** The RoPA table names a lawful basis on every row and has the rows P1.36 requires. */
export function ropaProblems(doc: string): string[] {
  const [header = [], ...rows] = tableRows(doc);
  const basis = header.indexOf("Lawful basis");
  if (basis < 0) return ["RoPA table has no Lawful basis column"];
  const problems = rows.filter((r) => (r[basis] ?? "") === "").map((r) => `RoPA row ${r[0]} has no lawful basis`);
  const activities = rows.map((r) => r[0]);
  if (!activities.includes("Dev PDS `device` table")) problems.push("RoPA has no row for the dev PDS `device` table");
  if (!activities.includes("Closed test track")) problems.push("RoPA has no row for the closed test track");
  return problems;
}

/** The fields P1.36 lists for the AI system record (plan §5.8, §6.1). */
export const AI_RECORD_FIELDS = [
  "Purpose",
  "Inputs",
  "Where it runs",
  "Processors and transfers",
  "Retention",
  "Notice shown to users",
  "Policy-text version",
  "False-positive rate",
  "False-negative rate",
  "S4 rate",
  "Labelled items: provenance and consent",
  "Human reviewer",
  "Appeal route",
  "Change control",
] as const;

/** The local models the record pins, each with name, version, sha256 and threshold. */
export const AI_RECORD_MODELS = ["nudity", "gore", "Detoxify", "Llama Guard 3 1B", "whisper.cpp"] as const;

/** Every field and model row is present and filled, with `TBD (Phase 4)` allowed unless strict. */
export function aiRecordProblems(doc: string, strict: boolean): string[] {
  const rows = tableRows(doc);
  const find = (name: string) => rows.find((r) => r[0] === name);
  const fields = AI_RECORD_FIELDS.map((field): string | null => {
    const value = find(field)?.[1] ?? "";
    if (value === "") return `AI record has no ${field} field`;
    return strict && value.includes(TBD) ? `AI record ${field} is TBD` : null;
  });
  const models = AI_RECORD_MODELS.map((model): string | null => {
    const row = find(model);
    if (row === undefined) return `AI record has no row for the ${model} model`;
    if (row.length < 5 || row.includes("")) return `AI record model ${model} has an empty cell`;
    return strict && row.some((c) => c.includes(TBD)) ? `AI record model ${model} is TBD` : null;
  });
  return [...fields, ...models].filter((problem) => problem !== null);
}
