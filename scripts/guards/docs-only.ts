// The read-only docs-only check (P0.07e). GitHub Actions runs this from the pull
// request checkout with contents: read only. The auto-merge workflow does not
// trust this process: it re-reads the file list from the API with the copy of
// docs-only-paths.ts on the default branch.
//
// Node runs this file by type stripping (nodejs.org/docs/latest-v26.x/api/typescript.html,
// stable since v25.2.0 / v24.12.0; .nvmrc is 26.12.0).
import { execFileSync } from "node:child_process";
import { docsOnlyRejection, parseNameStatus } from "./docs-only-paths.ts";

const SHA = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 30_000;

/** Exit code for one NUL-separated name-status diff. Empty and unreadable diffs fail. */
export function verdictFromStatus(status: string): number {
  let paths: ReturnType<typeof parseNameStatus>;
  try {
    paths = parseNameStatus(status);
  } catch (error) {
    console.error(`docs-only: ${error instanceof Error ? error.message : "bad diff"}`);
    return 1;
  }
  const reason = docsOnlyRejection(paths);
  if (reason !== null) {
    console.error(`docs-only: not allowed: ${reason}`);
    return 1;
  }
  console.log(`docs-only: ${paths.length} path(s)`);
  return 0;
}

export function main(): number {
  const base = process.env.BASE_SHA ?? "";
  const head = process.env.HEAD_SHA ?? "";
  if (!SHA.test(base) || !SHA.test(head)) {
    console.error("docs-only: BASE_SHA and HEAD_SHA must be 40 lowercase hex characters");
    return 1;
  }
  let status: string;
  try {
    // Three dots: changes the pull request introduced since the merge base.
    status = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", `${base}...${head}`], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`docs-only: git diff failed: ${error instanceof Error ? error.message : "error"}`);
    return 1;
  }
  return verdictFromStatus(status);
}

if (import.meta.main) process.exitCode = main();
