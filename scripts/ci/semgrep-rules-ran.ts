// Fails the semgrep job when its SARIF shows that no rules ran (a registry outage or licence change
// must never pass as a clean scan; P0.07 algorithm step 7), or that a rule in scripts/lint/semgrep/ was not loaded
// (P1.01s: registry rules must never stand in for ours). Logs the engine version and rule count.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Sarif = { runs?: { tool?: { driver?: { semanticVersion?: string; rules?: { id: string }[] } } }[] };

const RULES_DIR = "scripts/lint/semgrep";

function drivers(sarifText: string) {
  const sarif: Sarif = JSON.parse(sarifText);
  return (sarif.runs ?? []).map((run) => run.tool?.driver ?? {});
}

/** The number of rules the SARIF says were loaded, and the engine version that loaded them. */
export function rulesRan(sarifText: string): { rules: number; version: string } {
  const all = drivers(sarifText);
  const rules = all.reduce((sum, d) => sum + (d.rules?.length ?? 0), 0);
  return { rules, version: all[0]?.semanticVersion ?? "unknown" };
}

/** The rule ids declared in one rule file (`- id: <id>` entries). */
export function declaredRuleIds(yamlText: string): string[] {
  return [...yamlText.matchAll(/^\s*- id:\s*([\w.-]+)\s*$/gm)].map((match) => match[1] ?? "");
}

/**
 * The declared ids the SARIF does not list. Semgrep prefixes a local rule id with its config path
 * (`scripts.lint.semgrep.computed-import`), so an id matches on the part after the last dot.
 */
export function missingCustomRules(sarifText: string, ids: readonly string[]): string[] {
  const loaded = new Set(drivers(sarifText).flatMap((d) => (d.rules ?? []).map((r) => r.id.split(".").pop())));
  return ids.filter((id) => !loaded.has(id));
}

function customRuleIds(): string[] {
  return readdirSync(RULES_DIR)
    .filter((file) => file.endsWith(".yml"))
    .flatMap((file) => declaredRuleIds(readFileSync(join(RULES_DIR, file), "utf8")));
}

export function main(path: string): number {
  let sarifText: string;
  let result: { rules: number; version: string };
  try {
    sarifText = readFileSync(path, "utf8");
    result = rulesRan(sarifText);
  } catch (error) {
    console.error(`semgrep: no readable SARIF at ${path}: ${String(error)}`);
    return 1;
  }
  console.log(`semgrep ${result.version}: ${result.rules} rules ran`);
  if (result.rules === 0) {
    console.error("semgrep: zero rules ran; the scan proved nothing");
    return 1;
  }
  const missing = missingCustomRules(sarifText, customRuleIds());
  if (missing.length > 0) console.error(`semgrep: custom rules not loaded: ${missing.join(", ")}`);
  return missing.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv[2] ?? "");
