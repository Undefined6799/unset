// Guard (P0.09k): no two tracked paths differ only in letter case, so the repository checks out the same on
// case-insensitive file systems (macOS, Windows), where one of the pair would silently overwrite the other.
// Reads `git ls-files`, not the disk, and has no guard-allow: a pair is always fixed by renaming one of them.
import { execFileSync } from "node:child_process";
import type { Finding } from "./files.ts";
import { withoutGitEnv } from "./git-env.ts";

const RULE = "case-collision";

/** One finding per path whose lowercased form another tracked path shares, naming the others. */
export function findCaseCollisions(paths: readonly string[]): Finding[] {
  const groups = new Map<string, string[]>();
  for (const path of new Set(paths)) {
    const key = path.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  const findings: Finding[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const file of group) {
      const others = group.filter((p) => p !== file).join(", ");
      findings.push({ file, line: 1, rule: RULE, text: `differs only in case from ${others}` });
    }
  }
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Tracked paths in `root`; throws outside a git repository or when nothing is tracked, so the guard fails closed. */
function trackedPaths(root: string): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { env: withoutGitEnv(), encoding: "utf8" });
  const paths = out.split("\0").filter((p) => p !== "");
  if (paths.length === 0) throw new Error(`${RULE}: git ls-files listed no paths in ${root}`);
  return paths;
}

export function scanAll(root: string): Finding[] {
  return findCaseCollisions(trackedPaths(root));
}
