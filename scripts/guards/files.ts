// File discovery and the shared scan loop for the repository guards. Deliberately dependency-free.
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Skipped by every walker and by Vitest: a bare name anywhere, or a repo-relative path. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".worktrees",
  "graphify-out",
  "scripts/guards/fixtures",
  "scripts/lint/semgrep/fixtures",
]);
const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The decision-34 folders that hold code a guard reads. */
export const PRODUCT_DIRS = [
  "apps",
  "interfaces",
  "domains",
  "infrastructure",
  "shared",
  "deployment",
  "tests",
] as const;

/** Every file under `dirs` whose name matches `ext`, as repo-relative POSIX paths, sorted. */
export function filesUnder(root: string, dirs: readonly string[], ext: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // A listed top-level dir that does not exist yet is fine.
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const rel = relative(root, path).split(sep).join("/");
      if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel)) continue;
      if (entry.isDirectory()) walk(path);
      else if (ext.test(entry.name)) out.push(rel);
    }
  };
  for (const dir of dirs) walk(join(root, dir));
  return out.sort();
}

/** Every source file under `root`, as repo-relative POSIX paths, sorted. */
export function sourceFiles(root: string, dirs: readonly string[]): string[] {
  return filesUnder(root, dirs, SOURCE_EXT);
}

export function read(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}

export type Finding = { file: string; line: number; rule: string; text: string };

export const isTestFile = (file: string): boolean => /\.test\.[cm]?[jt]sx?$/.test(file);

/**
 * `// guard-allow: <rule> <reason>` exempts a line, and only as a line comment with a reason that has a word in it,
 * so every exception is explained and a marker inside a string or a bare block comment does not count.
 */
export function allowed(line: string, rule: string): boolean {
  return new RegExp(`//\\s*guard-allow:\\s*${rule}\\s+[^\\s*/]*\\w`).test(line);
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Reads each file strictly and scans it. A file that cannot be read or decoded is a finding: never skipped. */
export function scanFiles(
  root: string,
  files: readonly string[],
  rule: string,
  scan: (file: string, source: string) => Finding[],
): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = STRICT_UTF8.decode(readFileSync(join(root, file)));
    } catch {
      findings.push({ file, line: 1, rule, text: "unreadable" });
      continue;
    }
    findings.push(...scan(file, source));
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Module specifiers named on a line: `from "…"`, `import "…"`, `require("…")`, `import("…")`. */
export function specifiersOn(line: string): string[] {
  const out: string[] = [];
  const pattern =
    /\bfrom\s*["'`]([^"'`]+)["'`]|\bimport\s*\(?\s*["'`]([^"'`]+)["'`]|\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const m of line.matchAll(pattern)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** One line per finding, `file:line  [rule]  text`; P0.14 reads this format from the CI log. */
export function report(findings: readonly Finding[]): string {
  return findings.map((f) => `${f.file}:${f.line}  [${f.rule}]  ${f.text.trim()}`).join("\n");
}
