// P1.37: checks over the legal status table in docs/human/legal/. Each returns its problems as sentences, empty when
// every rule holds, so legal.test.ts can show it failing on a planted defect.

export const LEGAL_DIR = "docs/human/legal";
export const LEGAL_STATUS = `${LEGAL_DIR}/legal-status.md`;

const STATUSES = ["to do", "in progress", "submitted", "done"];
const STATUS_LIST = `${STATUSES.slice(0, -1).join(", ")} or ${STATUSES.at(-1)}`;
const HEADER = /^\| item \| status \| submitted \| expected \| next action \|$/m;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NONE = "—";
// Anything that reads as a marker, in any case or spacing; only the exact form below counts, the rest is malformed.
const MARKER_LIKE = /\[\s*lawyer\s+to\s+confirm\b[^\]]*\]/gi;
const MARKER = /^\[lawyer to confirm: (L[1-9]\d*)\]$/;
const ROW_ID = /^L[1-9]\d*$/;

/** A real calendar date in ISO form: 2026-02-30 and 2026-99-99 fail. */
function isIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return ISO_DATE.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The doc without HTML comments (an unclosed one runs to the end) and fenced code blocks, which render no table. */
function visible(doc: string): string {
  let fence: string | undefined;
  return doc
    .replace(/<!--[\s\S]*?(?:-->|$(?![\s\S]))/g, "")
    .split("\n")
    .filter((line) => {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === undefined && open !== undefined) fence = open;
      else if (fence !== undefined && open?.startsWith(fence)) fence = undefined;
      else return fence === undefined;
      return false;
    })
    .join("\n");
}

const cells = (raw: string): string[] => {
  const line = raw.trimEnd();
  return line
    .slice(1, line.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((c) => c.trim());
};

/** The status table's rows as cells: the lines after the header and its separator, up to the first non-table line. */
function statusRows(source: string): string[][] | undefined {
  const doc = visible(source.replaceAll("\r\n", "\n"));
  const header = HEADER.exec(doc);
  if (header === null) return undefined;
  const lines = doc.slice(header.index).split("\n").slice(2);
  const end = lines.findIndex((line) => !line.startsWith("|"));
  return lines.slice(0, end < 0 ? undefined : end).map(cells);
}

/** Every row has five cells, a known status and ISO dates (or none); a submitted or done item has its date. */
export function statusProblems(doc: string): string[] {
  const rows = statusRows(doc);
  if (rows === undefined) return ["legal-status.md has no item | status | submitted table"];
  if (rows.length === 0) return ["legal-status.md table has no rows"];
  return rows.flatMap((row) => {
    const [item = "", status = "", submitted = "", expected = ""] = row;
    if (row.length !== 5) return [`${item}: ${row.length} cells, not 5`];
    const problems: string[] = [];
    if (!STATUSES.includes(status)) problems.push(`${item}: status ${status} is not ${STATUS_LIST}`);
    for (const [name, value] of [
      ["submitted", submitted],
      ["expected", expected],
    ] as const) {
      if (value !== NONE && !isIsoDate(value)) problems.push(`${item}: ${name} ${value} is not an ISO date`);
    }
    if ((status === "submitted" || status === "done") && !isIsoDate(submitted)) {
      problems.push(`${item}: ${status} with no submission date`);
    }
    return problems;
  });
}

/** The markers a doc shows: inline code, fenced code and HTML comments are not markers. */
const markers = (doc: string): string[] =>
  [
    ...visible(doc)
      .replace(/`[^`\n]*`/g, "")
      .matchAll(MARKER_LIKE),
  ].map(([raw]) => raw);

/** Each marker in the docs is well formed and has a row; returns the problems and the ids the markers name. */
function markerUse(docs: Record<string, string>, rowIds: string[]): { problems: string[]; marked: Set<string> } {
  const problems: string[] = [];
  const marked = new Set<string>();
  for (const [file, text] of Object.entries(docs)) {
    for (const raw of markers(text)) {
      const id = MARKER.exec(raw)?.[1];
      if (id === undefined) {
        problems.push(`${file}: malformed marker ${raw}; write [lawyer to confirm: Ln]`);
        continue;
      }
      marked.add(id);
      if (!rowIds.includes(id)) problems.push(`${file}: ${id} has no row in legal-status.md`);
    }
  }
  return { problems, marked };
}

/**
 * Every [lawyer to confirm: Ln] marker in the folder has exactly one status row starting with its id, every L row has
 * a marker, and a marker in any other form fails.
 */
export function markerProblems(docs: Record<string, string>, status: string): string[] {
  const rowIds = (statusRows(status) ?? []).map(([item = ""]) => item.split(" ")[0] ?? "");
  const { problems, marked } = markerUse(docs, rowIds);
  for (const id of new Set(rowIds.filter((r) => ROW_ID.test(r)))) {
    const count = rowIds.filter((r) => r === id).length;
    if (count > 1) problems.push(`${id}: ${count} rows in legal-status.md`);
    if (!marked.has(id)) problems.push(`${id}: no marker in ${LEGAL_DIR}`);
  }
  return problems;
}
