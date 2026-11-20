// Guard (P2.19b): no tracked file holds a merge conflict marker. #1840's merge left markers in the step book, and
// nothing caught them because no check reads docs. This one reads every tracked text file, docs included, from
// `git ls-files`. It flags the opening, base (diff3) and closing markers at the start of a line; git always writes
// the opening and closing ones, so a conflict cannot pass, while a lone `=======` (a setext heading) is left alone.
// No guard-allow: a marker is always fixed by resolving the conflict. Fixture folders are skipped like every walker.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Finding, SKIP_DIRS } from "./files.ts";
import { withoutGitEnv } from "./git-env.ts";

const RULE = "conflict-markers";
const MARKER = /^(?:<{7}|\|{7}|>{7})(?: |$)/;

/** One finding per marker line in `text`, which is the contents of `file`. */
export function findConflictMarkers(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (MARKER.test(line)) findings.push({ file, line: index + 1, rule: RULE, text: "merge conflict marker" });
  });
  return findings;
}

const skipped = (path: string): boolean =>
  path.split("/").some((part, i, parts) => SKIP_DIRS.has(part) || SKIP_DIRS.has(parts.slice(0, i + 1).join("/")));

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
  const findings: Finding[] = [];
  for (const path of trackedPaths(root)) {
    if (skipped(path)) continue;
    const bytes = readFileSync(join(root, path));
    if (bytes.includes(0)) continue; // binary: git does not write markers into it
    findings.push(...findConflictMarkers(path, bytes.toString("utf8")));
  }
  return findings;
}
