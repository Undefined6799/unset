// Fails the semgrep job when its SARIF shows that no rules ran (a registry outage or licence change
// must never pass as a clean scan; P0.07 algorithm step 7). Logs the engine version and rule count.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type Sarif = { runs?: { tool?: { driver?: { semanticVersion?: string; rules?: { id: string }[] } } }[] };

/** The number of rules the SARIF says were loaded, and the engine version that loaded them. */
export function rulesRan(sarifText: string): { rules: number; version: string } {
  const sarif: Sarif = JSON.parse(sarifText);
  const drivers = (sarif.runs ?? []).map((run) => run.tool?.driver ?? {});
  const rules = drivers.reduce((sum, d) => sum + (d.rules?.length ?? 0), 0);
  return { rules, version: drivers[0]?.semanticVersion ?? "unknown" };
}

export function main(path: string): number {
  let result: { rules: number; version: string };
  try {
    result = rulesRan(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`semgrep: no readable SARIF at ${path}: ${String(error)}`);
    return 1;
  }
  console.log(`semgrep ${result.version}: ${result.rules} rules ran`);
  if (result.rules === 0) console.error("semgrep: zero rules ran; the scan proved nothing");
  return result.rules > 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv[2] ?? "");
