// Guard (P1.20c; ADR 0055 point 2): Tailwind utility classes appear only in the shadcn-svelte components
// (apps/web/lib/) and the app shell; pages compose components. In the SvelteKit routes folder the shell is the
// +layout.svelte files, so every other .svelte file there (pages, error pages, components kept beside a route) may
// not set a class: no `class=` attribute or prop, no `class:` directive. Lexical on purpose, comments included
// (reword a comment that trips it). No guard-allow: a page that needs a look gets it from a component or the shell.
import { type Finding, filesUnder, scanFiles } from "./files.ts";

const RULE = "page-classes";
export const ROUTES_DIR = "interfaces/web/src/routes";
const SHELL_FILE = /(?:^|\/)\+layout(?:@[^/]*)?\.svelte$/;
const CLASS = /(?:^|[\s{<])class\s*(?:=|:)/;

/** A route-folder .svelte file that is not a layout. */
export const isPageFile = (file: string): boolean =>
  file.startsWith(`${ROUTES_DIR}/`) && file.endsWith(".svelte") && !SHELL_FILE.test(file);

export function scanPageClasses(file: string, source: string): Finding[] {
  if (!isPageFile(file)) return [];
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (CLASS.test(text)) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

/** Every .svelte file under the routes folder; none exist until P1.20b, which is fine (a test plants one). */
export const scannedFiles = (root: string): string[] => filesUnder(root, [ROUTES_DIR], /\.svelte$/);

export function scanAll(root: string): Finding[] {
  return scanFiles(root, scannedFiles(root), RULE, scanPageClasses);
}
