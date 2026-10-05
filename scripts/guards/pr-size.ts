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

/** Sums added + deleted lines of `git diff --numstat` rows; binary rows (`-`) count 0. */
function countSource(numstat: string): number {
  let changed = 0;
  for (const row of numstat.split(/\r?\n/)) {
    const [added, deleted, path] = row.split("\t");
    if (path === undefined || NOT_SOURCE.some((pattern) => pattern.test(path))) continue;
    changed += (Number.parseInt(added ?? "", 10) || 0) + (Number.parseInt(deleted ?? "", 10) || 0);
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
