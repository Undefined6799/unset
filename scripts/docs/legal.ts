// P1.37: checks over the legal status table in docs/human/legal/. Each returns its problems as sentences, empty when
// every rule holds, so legal.test.ts can show it failing on a planted defect.

export const LEGAL_STATUS = "docs/human/legal/legal-status.md";
export const LEGAL_DOCS = ["docs/human/legal/cybertip-runbook.md", "docs/human/legal/incident-response.md"];

const STATUSES = ["to do", "in progress", "submitted", "done"];
const STATUS_LIST = `${STATUSES.slice(0, -1).join(", ")} or ${STATUSES.at(-1)}`;
const HEADER = /^\| item \| status \| submitted \| expected \| next action \|$/m;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NONE = "—";
const MARKER = /\[lawyer to confirm(?:: (L\d+))?\]/g;

const cells = (line: string): string[] =>
  line
    .slice(1, line.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((c) => c.trim());

/** The status table's rows as cells: the lines after the header and its separator, up to the first non-table line. */
function statusRows(doc: string): string[][] | undefined {
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
  return rows.flatMap((row) => {
    const [item = "", status = "", submitted = "", expected = ""] = row;
    if (row.length !== 5) return [`${item}: ${row.length} cells, not 5`];
    const problems: string[] = [];
    if (!STATUSES.includes(status)) problems.push(`${item}: status ${status} is not ${STATUS_LIST}`);
    for (const [name, value] of [
      ["submitted", submitted],
      ["expected", expected],
    ] as const) {
      if (value !== NONE && !ISO_DATE.test(value)) problems.push(`${item}: ${name} ${value} is not an ISO date`);
    }
    if ((status === "submitted" || status === "done") && !ISO_DATE.test(submitted)) {
      problems.push(`${item}: ${status} with no submission date`);
    }
    return problems;
  });
}

/** Every [lawyer to confirm: Ln] marker in the runbooks has exactly one status row starting with its id. */
export function markerProblems(docs: Record<string, string>, status: string): string[] {
  const rowIds = (statusRows(status) ?? []).map(([item = ""]) => item.split(" ")[0] ?? "");
  const problems: string[] = [];
  for (const [file, text] of Object.entries(docs)) {
    for (const [, id] of text.matchAll(MARKER)) {
      if (id === undefined) problems.push(`${file}: a [lawyer to confirm] marker has no id`);
      else if (!rowIds.includes(id)) problems.push(`${file}: ${id} has no row in legal-status.md`);
    }
  }
  for (const id of new Set(rowIds.filter((r) => /^L\d+$/.test(r)))) {
    const count = rowIds.filter((r) => r === id).length;
    if (count > 1) problems.push(`${id}: ${count} rows in legal-status.md`);
  }
  return problems;
}
