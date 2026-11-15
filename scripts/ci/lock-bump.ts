// Judges a pull request's change to the deploy lock, deployment/images.lock.json (P2.26j). Until this step a bumped
// lock was first verified on the host, by the deploy preflight. Two things are checked here, before the merge:
//
// 1. Order (this file). Every first-party entry the pull request changes names a commit that is on main, and that is
//    the locked commit or a later one. verify-images.ts proves an entry is some build our publish workflow signed from
//    the commit it names; it cannot tell a new build from an old one, so without this a bump could put back an older,
//    signed image.
// 2. Signatures (lock.yml's next step). When the lock changed, verify-images.ts verifies every entry against the
//    committed Sigstore trusted root, as the preflight does.
//
// The base is the tip of the branch the pull request merges into (BASE_SHA, github.event.pull_request.base.sha), so
// "on main" means an ancestor of that tip. `git merge-base --is-ancestor` exits 0 when the first commit is an ancestor
// of the second and 1 when it is not (git v2.43 Documentation/git-merge-base.txt, "--is-ancestor"); any other exit,
// such as 128 for an unknown commit, reads as "not an ancestor". The CLI appends `changed=true|false` to
// $GITHUB_OUTPUT (docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands, "Setting an output
// parameter") only when it passes; any error fails the job.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ImageLock, LockEntry } from "./verify-images.ts";

export const LOCK_PATH = "deployment/images.lock.json";
const COMMIT = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 30_000;

/** Whether `older` is `newer` or one of its ancestors. */
export type IsAncestor = (older: string, newer: string) => boolean;

/** Why one changed first-party entry may not replace `locked`, or null when it may. */
function entryProblem(entry: LockEntry, locked: LockEntry | undefined, mainTip: string, isAncestor: IsAncestor) {
  const commit = entry.gitCommit;
  if (commit === undefined || !COMMIT.test(commit)) return "gitCommit is not a full lowercase commit";
  if (!isAncestor(commit, mainTip)) return `gitCommit ${commit} is not on main`;
  const prior = locked?.origin === "first-party" ? locked.gitCommit : undefined;
  if (prior !== undefined && !isAncestor(prior, commit)) return `gitCommit ${commit} is older than the locked ${prior}`;
  return null;
}

/**
 * Why the first-party entries `head` changes may not replace `base`'s, one line each; empty when they may. An entry
 * that is equal on both sides is not judged: it is not this pull request's change.
 */
export function bumpProblems(
  base: ImageLock | null,
  head: ImageLock,
  mainTip: string,
  isAncestor: IsAncestor,
): string[] {
  const problems: string[] = [];
  for (const [name, entry] of Object.entries(head)) {
    const locked = base !== null && Object.hasOwn(base, name) ? base[name] : undefined;
    if (entry.origin !== "first-party" || isDeepStrictEqual(entry, locked)) continue;
    const problem = entryProblem(entry, locked, mainTip, isAncestor);
    if (problem !== null) problems.push(`${name}: ${problem}`);
  }
  return problems;
}

/** A lock file's text as an object of entries; throws on anything else. */
function parseLock(text: string): ImageLock {
  const lock: unknown = JSON.parse(text);
  if (typeof lock !== "object" || lock === null || Array.isArray(lock)) throw new Error("the lock is not an object");
  for (const entry of Object.values(lock)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new Error("a lock entry is not an object");
  }
  return lock as ImageLock;
}

export type MainDeps = { root: string; env: NodeJS.ProcessEnv; log: (line: string) => void };

/** The exit code of one run: 0 with a `changed` output, or 1 with the reasons logged. */
export function main({ root, env, log }: MainDeps): number {
  const base = env.BASE_SHA ?? "";
  if (!COMMIT.test(base)) {
    log("lock-bump: BASE_SHA must be 40 lowercase hex characters");
    return 1;
  }
  const git = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const isAncestor: IsAncestor = (older, newer) => {
    try {
      git(["merge-base", "--is-ancestor", older, newer]);
      return true;
    } catch {
      return false;
    }
  };
  let problems: string[];
  let changed: boolean;
  try {
    // The base commit must exist here; then a lock that `ls-tree` does not list at it is a first lock, not an error.
    git(["cat-file", "-e", `${base}^{commit}`]);
    const listed = git(["ls-tree", "--name-only", base, "--", LOCK_PATH]).trim() === LOCK_PATH;
    const baseLock = listed ? parseLock(git(["show", `${base}:${LOCK_PATH}`])) : null;
    const headLock = parseLock(readFileSync(join(root, LOCK_PATH), "utf8"));
    changed = !isDeepStrictEqual(baseLock, headLock);
    problems = bumpProblems(baseLock, headLock, base, isAncestor);
  } catch (error) {
    log(`lock-bump: ${error instanceof Error ? error.message : "unreadable lock"}`);
    return 1;
  }
  if (problems.length > 0) {
    for (const problem of problems) log(`lock-bump: ${problem}`);
    return 1;
  }
  if (env.GITHUB_OUTPUT === undefined || env.GITHUB_OUTPUT === "") {
    log("lock-bump: GITHUB_OUTPUT is unset");
    return 1;
  }
  appendFileSync(env.GITHUB_OUTPUT, `changed=${changed}\n`);
  log(`lock-bump: the lock ${changed ? "changed; every entry is verified next" : "did not change"}`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = main({ root: join(import.meta.dirname, "..", ".."), env: process.env, log: console.error });
}
