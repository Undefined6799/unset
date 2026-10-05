// Guard (P0.09k): no two tracked paths name the same file or folder on a case-insensitive file system (macOS, Windows),
// where one of the pair would silently overwrite or merge into the other. Folders count as well as files, so `a/x.ts`
// beside `A/y.ts` fails, and names compare after Unicode NFC and an upper-then-lower case fold. Reads `git ls-files`, not the
// disk, and has no guard-allow: a pair is always fixed by renaming one of them.
import { execFileSync } from "node:child_process";
import type { Finding } from "./files.ts";
import { withoutGitEnv } from "./git-env.ts";

const RULE = "case-collision";

/** The name a case-insensitive file system sees: NFC, then upper-then-lower folds pairs such as σ and ς. */
const folded = (path: string): string => path.normalize("NFC").toUpperCase().toLowerCase();
const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** Every tracked file and every folder above one. */
function entries(paths: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const path of paths) {
    out.add(path);
    for (let dir = parentOf(path); dir !== "" && !out.has(dir); dir = parentOf(dir)) out.add(dir);
  }
  return out;
}

/**
 * One finding per entry whose folded name another entry shares, naming the others. A pair whose parents differ is left
 * out: its parents collide too, and the finding there is the one to fix.
 */
export function findCaseCollisions(paths: readonly string[]): Finding[] {
  const groups = new Map<string, string[]>();
  for (const entry of entries(paths)) groups.set(folded(entry), [...(groups.get(folded(entry)) ?? []), entry]);
  const findings: Finding[] = [];
  for (const group of groups.values()) {
    if (group.length < 2 || new Set(group.map(parentOf)).size > 1) continue;
    for (const file of group) {
      const others = group.filter((p) => p !== file).join(", ");
      findings.push({ file, line: 1, rule: RULE, text: `same name as ${others} on a case-insensitive file system` });
    }
  }
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Tracked paths in `root`; throws outside a git repository or when nothing is tracked, so the guard fails closed. */
function trackedPaths(root: string): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    env: withoutGitEnv(),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const paths = out.split("\0").filter((p) => p !== "");
  if (paths.length === 0) throw new Error(`${RULE}: git ls-files listed no paths in ${root}`);
  return paths;
}

export function scanAll(root: string): Finding[] {
  return findCaseCollisions(trackedPaths(root));
}
