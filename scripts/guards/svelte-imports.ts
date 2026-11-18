// Guard (P1.20k, ADR 0056 decision 2, rule AB-1): a Svelte component never names a domain or infrastructure, and an
// app's component never names an interface, not even for a type. dependency-cruiser 18.7.0 compiles .svelte with the
// Svelte 5 compiler (src/extract/transpile/svelte-wrap.mjs, `compile(source, {})`), which erases `import type`, and it
// has no option to keep it; so `svelte-screens-no-core` and the apps rows of MATRIX never see a type-only import in a
// component. This scan names every specifier instead. Lexical, so a comment that names such a path counts too; reword
// it. No guard-allow.
import { posix } from "node:path";
import { type Finding, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

const RULE = "svelte-imports";
const SCANNED_DIRS = ["apps", "interfaces"];
const CORE = /^(@unset\/(domains|infrastructure)-|(domains|infrastructure)\/)/;
const INTERFACE = /^(@unset\/interfaces-|interfaces\/)/;

/** A relative specifier is resolved against the importing file, so `../../domains/x` is caught like the package. */
function target(file: string, specifier: string): string {
  return specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), specifier)) : specifier;
}

function refused(file: string, specifier: string): boolean {
  const to = target(file, specifier);
  return CORE.test(to) || (file.startsWith("apps/") && INTERFACE.test(to));
}

export function scanSvelteImports(file: string, source: string): Finding[] {
  if (!file.endsWith(".svelte")) return [];
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (specifiersOn(text).some((s) => refused(file, s))) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

/** The components the scan reads, so a test can prove it examined more than zero (AB-4). */
export function scannedFiles(root: string): string[] {
  return sourceFiles(root, SCANNED_DIRS).filter((file) => file.endsWith(".svelte"));
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, scannedFiles(root), RULE, scanSvelteImports);
}
