// ADR records (P1.38y; ADR 0083). Each ADR file is the only text a pull request edits by hand for its decision: an
// ADR from 0083 on carries its status in front matter, and each ADR from before has one frozen row in
// legacy-index.yaml. The index is generated from both and never committed, so two ADR pull requests share no file.
// `npm run adr:index` prints it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";

export const DECISIONS = "docs/human/decisions";
/** The rows of the ADRs that came before front matter, copied once from the old index (ADR 0083); never edited.
 * The docs site reads the same file (docs/site/layouts/_shortcodes/adr-index.html). */
export const LEGACY_INDEX = "legacy-index.yaml";

const STATUSES = ["Proposed", "Accepted", "Rejected"];
const KEYS = ["status", "date", "step", "supersedes", "amends", "accepted"];
const LINK_KEYS = ["adr", "part"];
const ACCEPTED_KEYS = ["at", "head", "line", "merged"];

type Link = { adr: string; part?: string };
export type FrontMatter = {
  status: "Proposed" | "Accepted" | "Rejected";
  date: string;
  step?: string;
  supersedes?: Link[];
  amends?: Link[];
  accepted?: { at: string; head: string; line: string; merged?: string };
};
export type LegacyRow = { adr: string; file: string; decision: string; status: string };
export type IndexRow = { adr: string; file: string; decision: string; status: string };

/** The YAML between a first line `---` and the next `---` line, or null when the file has no front matter. */
export function frontMatterText(text: string): string | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 3);
  return end < 0 ? null : text.slice(4, end + 1);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, pattern = /\S/): v is string => typeof v === "string" && pattern.test(v);
const unknownKeys = (v: Record<string, unknown>, allowed: string[], where: string): string[] =>
  Object.keys(v)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${where} has an unknown key "${k}"`);

/** A `supersedes` or `amends` list: each entry names an existing ADR, and `amends` always says which part. */
function linkProblems(value: unknown, key: string, adrs: ReadonlySet<string>, partRequired: boolean): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) return [`${key} is not a non-empty list`];
  return value.flatMap((link, i): string[] => {
    const where = `${key}[${i}]`;
    if (!isRecord(link)) return [`${where} is not a mapping`];
    const found = unknownKeys(link, LINK_KEYS, where);
    if (!isText(link.adr, /^\d{4}$/) || !adrs.has(link.adr)) found.push(`${where}.adr is not an existing ADR number`);
    if (link.part !== undefined || partRequired) {
      if (!isText(link.part)) found.push(`${where}.part is not text`);
    }
    return found;
  });
}

/** The `status` an ADR's front matter names, read as YAML (so quoting cannot hide it), or undefined. */
export function frontMatterStatus(text: string): unknown {
  const yamlText = frontMatterText(text);
  if (yamlText === null) return undefined;
  try {
    const doc: unknown = parse(yamlText);
    return isRecord(doc) ? doc.status : undefined;
  } catch {
    return undefined;
  }
}

/** Parses and checks one ADR's front matter against the fixed format; `value` is set only when nothing is wrong. */
export function parseFrontMatter(
  yamlText: string,
  adrs: ReadonlySet<string>,
): { value?: FrontMatter; problems: string[] } {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (error) {
    return { problems: [`front matter is not YAML (${(error as Error).message.split("\n")[0]})`] };
  }
  if (!isRecord(doc)) return { problems: ["front matter is not a mapping"] };
  const found = unknownKeys(doc, KEYS, "front matter");
  if (!isText(doc.status) || !STATUSES.includes(doc.status)) found.push(`status is not one of ${STATUSES.join(", ")}`);
  if (!isText(doc.date, /^\d{4}-\d{2}-\d{2}$/)) found.push("date is not a YYYY-MM-DD");
  if (doc.step !== undefined && !isText(doc.step, /^(P[0-6]\.\d{2}[a-z]?|L\.\d{2})$/))
    found.push("step is not a step id");
  found.push(
    ...linkProblems(doc.supersedes, "supersedes", adrs, false),
    ...linkProblems(doc.amends, "amends", adrs, true),
  );
  const accepted = doc.accepted;
  if ((accepted !== undefined) !== (doc.status === "Accepted"))
    found.push("accepted is set exactly when status is Accepted");
  if (isRecord(accepted)) {
    found.push(...unknownKeys(accepted, ACCEPTED_KEYS, "accepted"));
    if (!isText(accepted.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/)) found.push("accepted.at is not a UTC time");
    if (!isText(accepted.head, /^[0-9a-f]{7,40}$/)) found.push("accepted.head is not a commit");
    if (!isText(accepted.line)) found.push("accepted.line is not Alex's line");
    if (accepted.merged !== undefined && !isText(accepted.merged, /^[0-9a-f]{7,40}$/))
      found.push("accepted.merged is not a commit");
  } else if (accepted !== undefined) found.push("accepted is not a mapping");
  return found.length > 0 ? { problems: found } : { value: doc as FrontMatter, problems: [] };
}

/** The frozen rows, by ADR number: a YAML list of `{adr, file, decision, status}`, each a string. */
export function legacyRows(root: string): Map<string, LegacyRow> {
  const doc: unknown = parse(readFileSync(join(root, DECISIONS, LEGACY_INDEX), "utf8"));
  const rows = Array.isArray(doc) ? doc : [];
  const valid = rows.filter(
    (r): r is LegacyRow =>
      isRecord(r) &&
      Object.keys(r).join() === "adr,file,decision,status" &&
      [r.adr, r.file, r.decision, r.status].every((v) => typeof v === "string"),
  );
  if (!Array.isArray(doc) || valid.length !== rows.length) throw new Error(`${LEGACY_INDEX} is not a list of rows`);
  return new Map(valid.map((r) => [r.adr, r]));
}

/** The ADR files, `NNNN-title.md`, in number order. */
export function adrFiles(root: string): string[] {
  return readdirSync(join(root, DECISIONS))
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort();
}

const statusOf = (fm: FrontMatter): string =>
  fm.status === "Accepted"
    ? `Accepted ${fm.accepted?.at.slice(0, 10)}`
    : fm.status === "Proposed"
      ? "Proposed (awaiting Alex)"
      : "Rejected";

/** The one edit still allowed on an older accepted ADR (adrChangeProblem); the index shows it. */
const SUPERSEDED_LINE = /^Status: Superseded by (\d{4})\.?$/im;

/**
 * The index: one row per ADR file, from its front matter or else its frozen row. An older ADR keeps its frozen
 * decision text even once it has front matter, and its frozen status gives way to a "Status: Superseded by NNNN."
 * line. An accepted ADR's `supersedes` and `amends` are written onto the rows they name, so the older file is never
 * edited. Assumes adrProblems is clean.
 */
export function adrIndex(root: string): IndexRow[] {
  const legacy = legacyRows(root);
  const files = adrFiles(root);
  const adrs = new Set(files.map((f) => f.slice(0, 4)));
  const parsed = new Map<string, FrontMatter>();
  const rows = files.map((file): IndexRow => {
    const adr = file.slice(0, 4);
    const text = readFileSync(join(root, DECISIONS, file), "utf8");
    const yamlText = frontMatterText(text);
    const fm = yamlText === null ? undefined : parseFrontMatter(yamlText, adrs).value;
    const row = legacy.get(adr);
    if (fm === undefined) {
      const by = SUPERSEDED_LINE.exec(text)?.[1];
      const status = by ? `Superseded by ${by}` : (row?.status ?? "(no row)");
      return { adr, file, decision: row?.decision ?? "(no row)", status };
    }
    parsed.set(adr, fm);
    const title = new RegExp(`^# ${adr} — (.+)$`, "m").exec(text)?.[1] ?? "(no title)";
    return { adr, file, decision: row?.decision ?? title, status: statusOf(fm) };
  });
  const byAdr = new Map(rows.map((r) => [r.adr, r]));
  for (const [adr, fm] of parsed) {
    if (fm.status !== "Accepted") continue;
    for (const link of fm.supersedes ?? []) {
      const target = byAdr.get(link.adr);
      if (!target) continue;
      target.status = link.part ? `${target.status}; ${link.part} superseded by ${adr}` : `Superseded by ${adr}`;
    }
    for (const link of fm.amends ?? []) {
      const target = byAdr.get(link.adr);
      if (target) target.status = `${target.status}; ${link.part} amended by ${adr}`;
    }
  }
  return rows;
}

/** The index as the Markdown table the old README carried. */
export function renderIndex(rows: IndexRow[]): string {
  const lines = rows.map((r) => `| [${r.adr}](${r.file}) | ${r.decision} | ${r.status} |`);
  return ["| # | Decision | Status |", "| --- | --- | --- |", ...lines].join("\n") + "\n";
}

/**
 * The rows the docs site built (its adr-index shortcode publishes them as adr-index.json, keyed by number) against
 * adrIndex, one problem per ADR that differs. CI's docs-site job runs this after the Hugo build (ADR 0083).
 */
export function siteIndexProblems(rows: IndexRow[], siteJson: string): string[] {
  const site = JSON.parse(siteJson) as Record<string, unknown>;
  const ours = new Map(rows.map((r) => [r.adr, { decision: r.decision, file: r.file, status: r.status }]));
  const numbers = [...new Set([...ours.keys(), ...Object.keys(site)])].sort();
  return numbers
    .filter((n) => !isDeepStrictEqual(site[n], ours.get(n)))
    .map((n) => `ADR ${n}: the docs site has ${JSON.stringify(site[n])}, adrIndex has ${JSON.stringify(ours.get(n))}`);
}

if (import.meta.main) {
  const rows = adrIndex(join(import.meta.dirname, "..", ".."));
  const compare = process.argv.indexOf("--compare");
  if (compare < 0) process.stdout.write(renderIndex(rows));
  else {
    const problems = siteIndexProblems(rows, readFileSync(process.argv[compare + 1] ?? "", "utf8"));
    for (const p of problems) console.error(p);
    process.exitCode = problems.length > 0 ? 1 : 0;
    if (problems.length === 0) console.log(`The docs site's ADR index matches adrIndex (${rows.length} rows).`);
  }
}
