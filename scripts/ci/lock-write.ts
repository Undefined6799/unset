// Writes a published lock into the checkout (P2.26l): the first-party entries of deployment/images.lock.json and the
// same digests in deployment/compose.dev.yaml, the two files a lock bump changes. Until this step both were edited by
// hand from a publish run's summary.
//
// The input is the lock publish-images.yml wrote and verified in its run: one entry per image it built, each naming
// the run's commit. This file adds no trust. It refuses any input that is not exactly that shape, changes only
// entries that are already first-party in the committed lock (a new image, or a removed one, is a reviewed change made
// by hand), and leaves every mirror entry as it is. The pull request that carries the result is judged like any other
// bump: lock.yml verifies every entry's signature and provenance and refuses a move back (P2.26j).
//
// CLI: lock-write.ts <published lock file> <commit>. Node 26.12.0 runs this file directly (type stripping; .nvmrc).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageLock, LockEntry } from "./verify-images.ts";

export const LOCK_PATH = "deployment/images.lock.json";
export const COMPOSE_PATH = "deployment/compose.dev.yaml";
const COMMIT = /^[0-9a-f]{40}$/;
const NAME = /^[a-z0-9-]+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PUBLISHED_KEYS = ["gitCommit", "origin", "ref", "verify"];

/** A JSON object of objects, or a thrown error naming `what`. */
function parseLock(text: string, what: string): ImageLock {
  const lock: unknown = JSON.parse(text);
  const isObject = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isObject(lock) || !Object.values(lock as object).every(isObject)) throw new Error(`${what} is not a lock`);
  return lock as ImageLock;
}

/** Why one published entry is not what publish-images.yml writes for `name` at `commit`, or null. */
function publishedProblem(name: string, entry: LockEntry, commit: string): string | null {
  if (!NAME.test(name)) return "its name is not an image name";
  if (Object.keys(entry).sort().join() !== PUBLISHED_KEYS.join())
    return "it does not hold exactly ref, origin, gitCommit and verify";
  if (entry.origin !== "first-party" || entry.verify !== "cosign-keyless")
    return "it is not a first-party keyless entry";
  if (entry.gitCommit !== commit) return `it names commit ${String(entry.gitCommit)}, not ${commit}`;
  const [repository, digest, ...rest] = String(entry.ref).split("@");
  if (repository !== `ghcr.io/undefined6799/unset/${name}` || !DIGEST.test(digest ?? "") || rest.length > 0)
    return `its ref is not ghcr.io/undefined6799/unset/${name} by digest`;
  return null;
}

/** Throws unless `published` is one well-formed entry for each first-party entry of `current`, and nothing else. */
function assertPublishedMatches(published: ImageLock, current: ImageLock, commit: string): void {
  if (!COMMIT.test(commit)) throw new Error("the commit is not 40 lowercase hex characters");
  const problems = Object.entries(published).flatMap(([name, entry]) => {
    const problem = publishedProblem(name, entry, commit);
    return problem === null ? [] : [`${name}: ${problem}`];
  });
  const ours = Object.keys(current).filter((name) => current[name]?.origin === "first-party");
  for (const name of Object.keys(published)) {
    if (!ours.includes(name)) problems.push(`${name}: not a first-party entry of the committed lock`);
  }
  for (const name of ours) {
    if (!Object.hasOwn(published, name)) problems.push(`${name}: locked but not published`);
  }
  if (ours.length === 0) problems.push("the committed lock has no first-party entry");
  if (problems.length > 0) throw new Error(problems.join("\n"));
}

/**
 * The two files after the bump. The lock keeps its entry order and its mirror entries; the compose file changes only
 * where it names a replaced ref, and must name each one.
 */
export function bumpedFiles(
  publishedText: string,
  lockText: string,
  composeText: string,
  commit: string,
): { lock: string; compose: string } {
  const published = parseLock(publishedText, "the published lock");
  const current = parseLock(lockText, "the committed lock");
  assertPublishedMatches(published, current, commit);
  const next: ImageLock = {};
  let compose = composeText;
  for (const [name, entry] of Object.entries(current)) {
    const fresh = Object.hasOwn(published, name) ? published[name] : undefined;
    next[name] = fresh ?? entry;
    if (fresh === undefined || fresh.ref === entry.ref) continue;
    const line = `    image: ${entry.ref}\n`;
    if (!compose.includes(line)) throw new Error(`${name}: ${COMPOSE_PATH} does not run the locked ref`);
    compose = compose.replaceAll(line, `    image: ${fresh.ref}\n`);
    if (compose.includes(entry.ref))
      throw new Error(`${name}: ${COMPOSE_PATH} names the old ref outside an image line`);
  }
  return { lock: `${JSON.stringify(next, null, 2)}\n`, compose };
}

if (import.meta.main) {
  const [publishedPath, commit] = process.argv.slice(2);
  if (publishedPath === undefined || commit === undefined) {
    console.error("usage: lock-write.ts <published lock file> <commit>");
    process.exit(2);
  }
  const root = join(import.meta.dirname, "..", "..");
  try {
    const { lock, compose } = bumpedFiles(
      readFileSync(publishedPath, "utf8"),
      readFileSync(join(root, LOCK_PATH), "utf8"),
      readFileSync(join(root, COMPOSE_PATH), "utf8"),
      commit,
    );
    writeFileSync(join(root, LOCK_PATH), lock);
    writeFileSync(join(root, COMPOSE_PATH), compose);
    console.log(`lock-write: ${LOCK_PATH} and ${COMPOSE_PATH} name the images of ${commit}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
