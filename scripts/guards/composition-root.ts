// Guard (P1.04c; P1.04 composition_root_split, rules TE-1 and AB-2): each process's composition root is two files.
// `interfaces/<x>/main.ts` reads the config, calls `compose(config)` and starts what it returns; it imports
// `./compose.ts` exactly once and nothing from infrastructure/, and a `compose.ts` sits beside it. Only `compose.ts`
// builds adapters, so main.ts stays the same however the wiring changes. Lexical, and no guard-allow.
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { type Finding, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

const RULE = "composition-root";
const ENTRY_MAIN = /^interfaces\/[^/]+\/main\.ts$/;
const COMPOSE = "./compose.ts";
const INFRA_PACKAGE = /^@unset\/infrastructure-/;

function isInfrastructure(file: string, specifier: string): boolean {
  if (INFRA_PACKAGE.test(specifier)) return true;
  if (!specifier.startsWith(".")) return false;
  return posix.normalize(posix.join(posix.dirname(file), specifier)).startsWith("infrastructure/");
}

/** Findings for one entrypoint main.ts; `hasCompose` says whether compose.ts sits beside it. */
export function scanMain(file: string, source: string, hasCompose: boolean): Finding[] {
  const findings: Finding[] = [];
  const add = (line: number, text: string) => findings.push({ file, line, rule: RULE, text });
  if (!hasCompose) add(1, "no compose.ts beside main.ts");
  let composeImports = 0;
  source.split("\n").forEach((text, i) => {
    for (const specifier of specifiersOn(text)) {
      if (specifier === COMPOSE && ++composeImports > 1) add(i + 1, text);
      else if (isInfrastructure(file, specifier)) add(i + 1, text);
    }
  });
  if (composeImports === 0) add(1, "no import of ./compose.ts");
  return findings;
}

export function scanAll(root: string): Finding[] {
  const mains = sourceFiles(root, ["interfaces"]).filter((file) => ENTRY_MAIN.test(file));
  return scanFiles(root, mains, RULE, (file, source) =>
    scanMain(file, source, existsSync(join(root, posix.dirname(file), "compose.ts"))),
  );
}
