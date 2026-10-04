// Source discovery shared by the guards. Deliberately dependency-free.
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".worktrees", "graphify-out"]);
const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Every source file under `root`, as repo-relative POSIX paths, sorted. */
export function sourceFiles(root: string, dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // A listed top-level dir that does not exist yet is fine.
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (SOURCE_EXT.test(entry.name)) out.push(relative(root, path).split(sep).join("/"));
    }
  };
  for (const dir of dirs) walk(join(root, dir));
  return out.sort();
}

export function read(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}

export type Finding = { file: string; line: number; rule: string; text: string };

/** Lines carrying `guard-allow: <rule>` are exempt from that rule, so every exception is visible in review. */
export function allowed(line: string, rule: string): boolean {
  return line.includes(`guard-allow: ${rule}`);
}

export function report(findings: Finding[], help: string): number {
  for (const f of findings) console.error(`${f.file}:${f.line}  [${f.rule}]  ${f.text.trim()}`);
  if (findings.length > 0) console.error(`\n${findings.length} finding(s). ${help}`);
  return findings.length > 0 ? 1 : 0;
}
