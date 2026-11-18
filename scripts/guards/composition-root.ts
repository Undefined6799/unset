// Guard (P1.04c; P1.04 composition_root_split, rules TE-1 and AB-2): only a process's composition root builds adapters.
// A plain process has `interfaces/<x>/main.ts`, which reads the config, calls `compose(config)` and starts what it
// returns. The SvelteKit web process (ADR 0054) has two entry files instead: `server.ts` starts adapter-node's handler,
// and `src/hooks.server.ts` runs `startServices` from `src/lib/server/compose.ts`. An entry file imports nothing from
// infrastructure/; one that wires services imports its compose.ts exactly once, and that compose.ts exists. P1.20k
// added the SvelteKit entries: after the move this guard matched no file. Lexical, and no guard-allow.
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { type Finding, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

const RULE = "composition-root";
const INFRA_PACKAGE = /^@unset\/infrastructure-/;

/** An entry file, and the compose.ts it must import (relative to it), or null when it only must not build adapters. */
interface Entry {
  readonly path: RegExp;
  readonly compose: string | null;
}

const ENTRIES: readonly Entry[] = [
  { path: /^interfaces\/[^/]+\/main\.ts$/, compose: "./compose.ts" },
  { path: /^interfaces\/[^/]+\/src\/hooks\.server\.ts$/, compose: "./lib/server/compose.ts" },
  { path: /^interfaces\/[^/]+\/server\.ts$/, compose: null },
];

function isInfrastructure(file: string, specifier: string): boolean {
  if (INFRA_PACKAGE.test(specifier)) return true;
  if (!specifier.startsWith(".")) return false;
  return posix.normalize(posix.join(posix.dirname(file), specifier)).startsWith("infrastructure/");
}

/** Findings for one entry file; `hasCompose` says whether its compose.ts exists (ignored when `compose` is null). */
export function scanEntry(file: string, source: string, compose: string | null, hasCompose: boolean): Finding[] {
  const findings: Finding[] = [];
  const add = (line: number, text: string) => findings.push({ file, line, rule: RULE, text });
  if (compose !== null && !hasCompose) add(1, `no ${compose} beside ${posix.basename(file)}`);
  let composeImports = 0;
  source.split("\n").forEach((text, i) => {
    for (const specifier of specifiersOn(text)) {
      if (compose !== null && specifier === compose && ++composeImports > 1) add(i + 1, text);
      else if (isInfrastructure(file, specifier)) add(i + 1, text);
    }
  });
  if (compose !== null && composeImports === 0) add(1, `no import of ${compose}`);
  return findings;
}

function entryOf(file: string): Entry | undefined {
  return ENTRIES.find((entry) => entry.path.test(file));
}

/** The entry files in the tree, so a test can prove the scan examined more than zero (AB-4). */
export function entryFiles(root: string): string[] {
  return sourceFiles(root, ["interfaces"]).filter((file) => entryOf(file) !== undefined);
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, entryFiles(root), RULE, (file, source) => {
    const { compose } = entryOf(file) as Entry;
    const hasCompose = compose !== null && existsSync(join(root, posix.dirname(file), compose));
    return scanEntry(file, source, compose, hasCompose);
  });
}
