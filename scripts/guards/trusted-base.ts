// The trusted base (P0.09c; rule SE-6, plan §9): a pull request that changes the trusted base changes nothing else,
// so its reviewer reads security code alone. `.github/CODEOWNERS`'s last section is the one list of trusted paths.
// The reader fails closed: a section it cannot read is an error, never "no trusted base".

import type { GrantFinding } from "./grant-parse.ts";

export type TrustedBase = { patterns: string[]; parsedPaths: string[]; trustedFunctions: string[]; checks: string[] };
export type TrustedBaseRead = { ok: true; section: TrustedBase } | { ok: false; error: string };
export type Isolation = { ok: true; touched: boolean } | { ok: false; outside: string[] };
/** What git says about the changed paths that the documentation exemptions need: which are regular files (mode
 * 100644; a symlink never counts as documentation) and which `package.json` diffs change only the `license` key. */
export type DocFacts = { regular: ReadonlySet<string>; licenceOnly: ReadonlySet<string> };

const HEADING = "# trusted base (SE-6)";
const PARSED = "# parsed:";
const FUNCTIONS = "# trusted functions:";
/** Check paths (ruling 2026-10-05, refined 01:15Z): what decides whether CI passes. CI runs the PR's own copy, so a
 * PR that changes one changes no product path, and review sees a weakened check on its own. */
const CHECKS = "# checks:";
/** Product paths (decision 34's layout): the code the checks judge. */
const PRODUCT = ["apps/", "interfaces/", "domains/", "infrastructure/", "shared/", "deployment/"];

/** The path patterns and the three `#` lists of the section's lines, or an error for a repeated list line. */
function readSectionLines(section: readonly string[]): { patterns: string[]; lists: Map<string, string[]> } | string {
  const patterns: string[] = [];
  const lists = new Map<string, string[]>();
  for (const line of section) {
    const key = [PARSED, FUNCTIONS, CHECKS].find((prefix) => line.startsWith(prefix));
    if (key !== undefined) {
      if (lists.has(key)) return `a second "${key}" line`;
      lists.set(key, line.slice(key.length).trim().split(/\s+/).filter(Boolean));
    } else if (!line.startsWith("#")) {
      const pattern = line.trim().split(/\s+/)[0] as string;
      // Only anchored, wildcard-free paths: their CODEOWNERS meaning is plain, so matching cannot under-match.
      if (!/^\/[^*?[\]!\\]+$/.test(pattern)) return `pattern ${pattern} is not an anchored path`;
      patterns.push(pattern);
    }
  }
  return { patterns, lists };
}

/** Reads the `# trusted base (SE-6)` section: from its heading to the end of the file, with no blank line. */
export function readTrustedBase(codeowners: string): TrustedBaseRead {
  const lines = codeowners.split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
  const start = lines.indexOf(HEADING);
  if (start === -1) return { ok: false, error: `no "${HEADING}" section` };
  const section = lines.slice(start + 1);
  if (section.includes(HEADING)) return { ok: false, error: `a second "${HEADING}" line` };
  if (section.some((line) => line.trim() === "")) {
    return { ok: false, error: "a blank line inside the section (it must be the last section, with no blank line)" };
  }
  const read = readSectionLines(section);
  if (typeof read === "string") return { ok: false, error: read };
  const { patterns, lists } = read;
  const parsedPaths = lists.get(PARSED) ?? [];
  const trustedFunctions = lists.get(FUNCTIONS) ?? [];
  if (parsedPaths.length === 0) return { ok: false, error: `no "${PARSED}" paths` };
  if (trustedFunctions.length === 0) return { ok: false, error: `no "${FUNCTIONS}" names` };
  if (patterns.length === 0) return { ok: false, error: "no path patterns" };
  // A missing "# checks:" line reads as no paths: the base branch before P0.09c has none. The caller merges the base
  // and head sections and fails when the merged list is empty.
  const checks = lists.get(CHECKS) ?? [];
  if (checks.some((path) => !path.startsWith("/"))) return { ok: false, error: `a "${CHECKS}" path is not anchored` };
  return { ok: true, section: { patterns, parsedPaths, trustedFunctions, checks } };
}

/** An anchored CODEOWNERS path: `/dir/` covers the folder; `/name` covers that file, or that folder's contents. */
export function matchesPattern(path: string, pattern: string): boolean {
  const target = pattern.replace(/^\//, "");
  return target.endsWith("/") ? path.startsWith(target) : path === target || path.startsWith(`${target}/`);
}

/** The folder name a test under tests/ must carry: a folder pattern's last segment, a file pattern's parent. */
function folderName(pattern: string): string {
  const segments = pattern.split("/").filter(Boolean);
  return (pattern.endsWith("/") ? segments.at(-1) : segments.at(-2)) ?? "";
}

type Kind = "trusted" | "feature" | "mixed";

const PACKAGE_ROOT = "^(?:apps|interfaces|domains|infrastructure|shared)/[^/]+/";
const LICENCE = new RegExp(`${PACKAGE_ROOT}LICENSE(?:\\.md|\\.txt)?$`);
const MANIFEST = new RegExp(`${PACKAGE_ROOT}package\\.json$`);

/**
 * Documentation, which neither touches the trusted base nor makes a PR a product PR (ruling 2026-10-05 01:40Z): a
 * regular file that is a package's licence text (exact basename), any `*.md`, or a `package.json` whose diff changes
 * only its `license` key.
 */
export function isDocumentation(path: string, docs: DocFacts): boolean {
  if (!docs.regular.has(path)) return false;
  return LICENCE.test(path) || path.endsWith(".md") || (MANIFEST.test(path) && docs.licenceOnly.has(path));
}

/** A path under a parsed path is classified by its grant findings; any other path by the patterns. */
function kindOf(
  path: string,
  patterns: readonly string[],
  parsedPaths: readonly string[],
  findings: readonly GrantFinding[],
  docs: DocFacts,
) {
  // A parsed path is judged by its findings first: the grant guard reads every file under migrations/, docs included.
  if (parsedPaths.some((parsed) => matchesPattern(path, parsed))) {
    const kinds = new Set(findings.filter((f) => f.path === path).map((f) => f.kind === "trusted"));
    if (kinds.has(true) && kinds.has(false)) return { kind: "mixed" as Kind, folder: "postgres" };
    return { kind: (kinds.has(true) ? "trusted" : "feature") as Kind, folder: "postgres" };
  }
  if (isDocumentation(path, docs)) return { kind: "feature" as Kind, folder: "" };
  const pattern = patterns.find((p) => matchesPattern(path, p));
  return { kind: (pattern ? "trusted" : "feature") as Kind, folder: pattern ? folderName(pattern) : "" };
}

/** Human documentation and the AI working notes (the step book among them) hold no code. */
const isDocs = (path: string): boolean => path.startsWith("docs/human/") || path.startsWith("docs/ai/");

/** A test of a trusted-base file, or documentation of one; either may ride with it. */
function ridesAlong(path: string, patterns: readonly string[], folders: ReadonlySet<string>, docs: DocFacts) {
  const stem = /^(.*)\.test\.ts$/.exec(path)?.[1];
  if (stem !== undefined && patterns.some((p) => matchesPattern(`${stem}.ts`, p))) return true;
  if (path.startsWith("tests/") && path.split("/").some((segment) => folders.has(segment))) return true;
  return isDocumentation(path, docs) || (isDocs(path) && docs.regular.has(path));
}

export function checkTrustedBaseIsolation(
  changedPaths: readonly string[],
  trustedPatterns: readonly string[],
  parsed: { parsedPaths: readonly string[]; findings: readonly GrantFinding[]; docs: DocFacts },
): Isolation {
  const kinds = changedPaths.map((path) => ({
    path,
    ...kindOf(path, trustedPatterns, parsed.parsedPaths, parsed.findings, parsed.docs),
  }));
  const mixed = kinds.filter((k) => k.kind === "mixed");
  const trusted = kinds.filter((k) => k.kind !== "feature");
  if (trusted.length === 0) return { ok: true, touched: false };
  const folders = new Set(trusted.map((k) => k.folder).filter(Boolean));
  const outside = [
    ...mixed.map((k) => `${k.path} (mixed_grant_change)`),
    ...kinds
      .filter((k) => k.kind === "feature" && !ridesAlong(k.path, trustedPatterns, folders, parsed.docs))
      .map((k) => k.path),
  ];
  return outside.length === 0 ? { ok: true, touched: true } : { ok: false, outside };
}

/** The product paths of a PR that also changes a check path; empty when the PR keeps them apart. */
export function checkPathsMixed(changedPaths: readonly string[], checks: readonly string[], docs: DocFacts): string[] {
  if (!changedPaths.some((path) => checks.some((pattern) => matchesPattern(path, pattern)))) return [];
  return changedPaths.filter((path) => PRODUCT.some((dir) => path.startsWith(dir)) && !isDocumentation(path, docs));
}

/** Both CODEOWNERS sections merged, base and head: a PR cannot leave a list by editing it. */
export function unionTrustedBase(base: TrustedBase, head: TrustedBase): TrustedBase {
  const union = (pick: (s: TrustedBase) => string[]) => [...new Set([...pick(base), ...pick(head)])];
  return {
    patterns: union((s) => s.patterns),
    parsedPaths: union((s) => s.parsedPaths),
    trustedFunctions: union((s) => s.trustedFunctions),
    checks: union((s) => s.checks),
  };
}
