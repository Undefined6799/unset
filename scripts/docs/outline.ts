// The step outline is a dependency graph (P0.09w). Rows live in docs/ai/book/01-outline.md; each step heading
// in a phase file carries the same ids on its Depends on line. Retired and folded rows stay valid targets, and
// their own dependency cells are not walked.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * P0.09c's step id, `scripts/guards/commit-msg.ts` STEP_ID. The outline's dependency check names that pattern
 * (docs/ai/book/01-outline.md, "Dependency check").
 */
const STEP_ID = /^(P[0-6]\.\d{2}[a-z]?|L\.\d{2}[a-z]?)$/;
/** The same id inside prose. The letter is greedy, and the id must end at a non-id character so `P0.09` is not read out of `P0.09a`. */
const STEP_ID_IN_TEXT = /P[0-6]\.\d{2}[a-z]?|L\.\d{2}[a-z]?/g;
const STEP_HEADER = "Id|Step|Tags|Deps|Owner file";
const HEADING = /^### (P[0-6]\.\d{2}[a-z]?|L\.\d{2}[a-z]?) — /;
const IGNORED_ROW = /\*\*(?:Retired|Folded)\*\*/;

export type OutlineRow = { id: string; deps: string[]; stated: string[]; ignored: boolean };
export type PhaseText = { file: string; text: string };

const cells = (line: string): string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

const FIELD_END = /\b(?:Plan|Class|Runs before|Where|Size):/;

/** Step ids named in prose. Words such as "Alex's typed approval" are not ids. `P4.00\*` is the outline's implied edge. */
function idsIn(text: string): { id: string; implied: boolean }[] {
  const found: { id: string; implied: boolean }[] = [];
  for (const match of text.matchAll(STEP_ID_IN_TEXT)) {
    const id = match[0];
    const at = match.index;
    if (at === undefined) continue;
    const after = text.slice(at + id.length);
    if (/^[A-Za-z0-9]/.test(after)) continue;
    found.push({ id, implied: after.startsWith("\\*") || after.startsWith("*") });
  }
  return found;
}

/** Step ids named in prose. Words such as "Alex's typed approval" are not ids. */
export function stepIds(text: string): string[] {
  return [...new Set(idsIn(text).map((item) => item.id))];
}

/**
 * The dependency ids on one `Depends on:` line. The clause ends at the next field label (`Plan:`, `Class:`,
 * `Runs before:`, `Where:`, `Size:`), so a citation or a "runs before" note is not a dependency.
 */
export function dependsOnIds(line: string): string[] {
  const start = line.indexOf("Depends on:");
  if (start < 0) return [];
  let rest = line.slice(start + "Depends on:".length);
  const end = rest.search(FIELD_END);
  if (end >= 0) rest = rest.slice(0, end);
  return [...new Set(stepIds(rest))];
}

/** Every step-table row. A row is ignored when its step cell is retired or folded. */
export function outlineRows(outline: string): OutlineRow[] {
  const rows: OutlineRow[] = [];
  let inTable = false;
  for (const line of outline.split("\n")) {
    if (cells(line).join("|") === STEP_HEADER) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    const [id, step, , deps] = cells(line);
    if (id === undefined || step === undefined || deps === undefined || !STEP_ID.test(id)) continue;
    const named = idsIn(deps);
    rows.push({
      id,
      deps: [...new Set(named.map((item) => item.id))],
      // `P4.00\*` is an edge the outline adds because phase-4.md leaves it off the heading (01-outline.md).
      stated: [...new Set(named.filter((item) => !item.implied).map((item) => item.id))],
      ignored: IGNORED_ROW.test(step),
    });
  }
  return rows;
}

/** A dependency id that names no row, and a repeated row id. Retired and folded rows contribute no dependencies. */
export function unknownDependencyProblems(outline: string): string[] {
  const rows = outlineRows(outline);
  const known = new Set(rows.map((row) => row.id));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) problems.push(`duplicate outline row ${row.id}`);
    seen.add(row.id);
    if (row.ignored) continue;
    for (const dep of row.deps) {
      if (!known.has(dep)) problems.push(`${row.id} depends on ${dep}, which has no outline row`);
    }
  }
  return problems;
}

/**
 * One cycle, ids in edge order, or none. An edge runs from a step to a dependency. Retired and folded rows
 * are targets only: their dependencies are not edges.
 */
export function cycleProblems(outline: string): string[] {
  const rows = outlineRows(outline);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const done = new Set<string>();
  const stack: string[] = [];
  const active = new Set<string>();

  const visit = (id: string): string[] | null => {
    if (done.has(id)) return null;
    if (active.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    active.add(id);
    stack.push(id);
    const row = byId.get(id);
    if (row !== undefined && !row.ignored) {
      for (const dep of row.deps) {
        if (!byId.has(dep)) continue;
        const cycle = visit(dep);
        if (cycle !== null) return cycle;
      }
    }
    stack.pop();
    active.delete(id);
    done.add(id);
    return null;
  };

  for (const row of rows) {
    if (row.ignored) continue;
    const cycle = visit(row.id);
    if (cycle !== null) return [`cycle ${cycle.join(" -> ")}`];
  }
  return [];
}

/** The label that opens a dependency declaration. Tags and Depends on may be bold. */
const DEPENDS_LABEL = /^(?:\*\*)?(?:Tags|Depends on):/;

const CONTINUES_WITH_ID = /^(?:P[0-6]\.\d{2}[a-z]?|L\.\d{2}[a-z]?)/;

/** The step's own `Depends on:` line. A wrapped list continues only while the next line starts with a step id. */
function headingDepends(section: string): string | null {
  const lines = section.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!trimmed.includes("Depends on:") || !DEPENDS_LABEL.test(trimmed)) continue;
    const parts = [lines[i] ?? ""];
    if (!FIELD_END.test(trimmed)) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]?.trim() ?? "";
        if (!CONTINUES_WITH_ID.test(next)) break;
        parts.push(lines[j] ?? "");
        if (FIELD_END.test(next)) break;
      }
    }
    return parts.join(" ");
  }
  return null;
}

type Heading = { id: string; file: string; deps: string[] | null };

function headings(phases: readonly PhaseText[]): Heading[] {
  const found: Heading[] = [];
  for (const phase of phases) {
    const lines = phase.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || !HEADING.test(line)) continue;
      const id = HEADING.exec(line)?.[1];
      if (id === undefined) continue;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]?.startsWith("### ")) {
          end = j;
          break;
        }
      }
      const depends = headingDepends(lines.slice(i + 1, end).join("\n"));
      found.push({ id, file: phase.file, deps: depends === null ? null : dependsOnIds(depends) });
    }
  }
  return found;
}

const listed = (ids: readonly string[]): string => (ids.length === 0 ? "none" : [...ids].sort().join(", "));

/** Each phase heading's dependency ids equal its outline row's, as a set. */
export function headingMismatchProblems(outline: string, phases: readonly PhaseText[]): string[] {
  const rows = outlineRows(outline);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const heading of headings(phases)) {
    const earlier = seen.get(heading.id);
    if (earlier !== undefined) {
      problems.push(`${heading.id}: heading appears in ${earlier} and ${heading.file}`);
      continue;
    }
    seen.set(heading.id, heading.file);
    const row = byId.get(heading.id);
    if (row === undefined) {
      problems.push(`${heading.id} (${heading.file}): heading has no outline row`);
      continue;
    }
    if (heading.deps === null) {
      problems.push(`${heading.id} (${heading.file}): heading has no Depends on line`);
      continue;
    }
    const rowDeps = new Set(row.stated);
    const headingDeps = new Set(heading.deps);
    const same = rowDeps.size === headingDeps.size && [...rowDeps].every((id) => headingDeps.has(id));
    if (!same) {
      problems.push(`${heading.id}: heading depends on ${listed(heading.deps)}; row depends on ${listed(row.deps)}`);
    }
  }
  return problems;
}

/** Every `phase-*.md` in the book, sorted by file name. */
export function readPhaseTexts(root: string): PhaseText[] {
  const dir = join(root, "docs/ai/book");
  return readdirSync(dir)
    .filter((file) => /^phase-.*\.md$/.test(file))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));
}
