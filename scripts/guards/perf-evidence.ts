// Performance evidence (P0.09c; plan §6.1, rule PF-1): a migration that adds an index for speed (P1.11's
// `-- why: speed` comment) is justified by measurements, so the PR body's Performance evidence field gives p50,
// p95 and p99 rather than n/a.

const SPEED_INDEX = /--\s*why:\s*speed\b/i;

/** The text under `## Performance evidence`, up to the next heading; undefined when the heading is missing. */
function evidence(body: string): string | undefined {
  return /^## Performance evidence[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body.replaceAll("\r", ""))?.[1];
}

/** True when the migration diff adds a speed index and the body lacks p50, p95 and p99 (an error). */
export function checkPerfEvidence(migrationDiff: string, body: string): boolean {
  const added = migrationDiff.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  if (!added.some((line) => SPEED_INDEX.test(line))) return false;
  const text = evidence(body)?.trim() ?? "";
  if (text === "" || text.toLowerCase() === "n/a") return true;
  return !["p50", "p95", "p99"].every((percentile) => new RegExp(`\\b${percentile}\\b`, "i").test(text));
}
