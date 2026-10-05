// PR size (P0.09c; rule D3, DL-1): changed source lines, with tests, fixtures, the lockfile, generated code and
// lexicon JSON left out. Over 400 warns, so a reviewer looks; over 800 fails unless the author labels the PR
// `large-pr` and says why on a `Large PR:` line. The numbers prompt a look, they are never a target.

export type PrSize = { changed: number; level: "ok" | "warn" | "fail"; reason?: string };

const WARN_ABOVE = 400;
const FAIL_ABOVE = 800;
const NOT_SOURCE: readonly RegExp[] = [
  /\.(test|spec)\.[^/]+$/,
  /^tests\//,
  /(^|\/)fixtures\//,
  /(^|\/)package-lock\.json$/,
  /\.generated\.[^/]+$/,
  /^shared\/lexicons\/.*\.json$/,
];

const isExcluded = (path: string): boolean => NOT_SOURCE.some((pattern) => pattern.test(path));

/**
 * The `git diff` arguments for the count (P0.09h): `--find-renames` at git's default 50% similarity, so a moved file
 * pairs with its old path and a heavy rewrite does not (git v2.43.0 `Documentation/diff-options.txt`, `-M`). The
 * threshold is never lowered: a rewritten file must not pass as a cheap move.
 */
export const NUMSTAT_ARGS = ["-z", "--numstat", "--find-renames"] as const;

/**
 * `git diff -z --numstat` output as tab-separated lines: `added, deleted, path`, plus the old path for a rename. With
 * `-z` a rename is `added TAB deleted TAB NUL old NUL new NUL` (git v2.43.0 `Documentation/diff-format.txt:165-179`).
 * A path with a newline is refused, since the lines could not carry it.
 */
export function numstatLines(z: string): string {
  const fields = z.split("\0");
  const rows: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    if (field === "") continue;
    const row = field.endsWith("\t") ? [`${field}${fields[i + 2] ?? ""}`, fields[i + 1] ?? ""] : [field];
    if (field.endsWith("\t")) i += 2;
    if (row.some((part) => part.includes("\n"))) throw new Error("a changed path contains a newline");
    rows.push(row.join("\t"));
  }
  return rows.join("\n");
}

/**
 * Sums added + deleted lines of the numstat lines; binary rows (`-`) count 0. A rename counts its changed lines like an
 * edit in place, and a pure rename (nothing changed) counts 1. A renamed row counts when either path is source, so
 * edited source cannot hide by moving into an excluded path (architecture ruling 2026-10-05 13:10Z).
 */
function countSource(numstat: string): number {
  let changed = 0;
  for (const row of numstat.split(/\r?\n/)) {
    const [added, deleted, path, from] = row.split("\t");
    if (path === undefined || [path, from].every((p) => p === undefined || isExcluded(p))) continue;
    const lines = (Number.parseInt(added ?? "", 10) || 0) + (Number.parseInt(deleted ?? "", 10) || 0);
    changed += from !== undefined && lines === 0 ? 1 : lines;
  }
  return changed;
}

/** The text after the first `Large PR:` line, or "" when there is none. */
function largePrReason(body: string): string {
  return /^Large PR:(.*)$/m.exec(body.replaceAll("\r", ""))?.[1]?.trim() ?? "";
}

export function measurePrSize(numstat: string, labels: readonly string[], body: string): PrSize {
  const changed = countSource(numstat);
  if (changed <= WARN_ABOVE) return { changed, level: "ok" };
  if (changed <= FAIL_ABOVE) return { changed, level: "warn", reason: `over ${WARN_ABOVE} changed source lines` };
  const reason = largePrReason(body);
  if (labels.includes("large-pr") && reason !== "") return { changed, level: "warn", reason: `large-pr: ${reason}` };
  return {
    changed,
    level: "fail",
    reason: `over ${FAIL_ABOVE} changed source lines without the large-pr label and a \`Large PR:\` reason`,
  };
}
