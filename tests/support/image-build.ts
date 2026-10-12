// Test image builds (P1.27x). Two builds of one Dockerfile and context get the same image id from BuildKit's cache, so
// a test that removed its image by id with `rmi -f` removed it under every other test that built it too: CI saw
// "No such image" in package-manager.image.test.ts after migrate.image.test.ts cleaned up (#686). Each build gets its
// own tag instead, and cleanup removes only that tag without -f; Docker deletes the image when its last tag goes
// (docs.docker.com, "docker image rm": "If an image has multiple tags, using this command with the tag as a parameter
// only removes the tag"). Only image tests import this module (P1.28r).
import { randomBytes } from "node:crypto";
import { basename, join, relative } from "node:path";
import { type Call, docker } from "./docker.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..");

/** Builds `dockerfile` with `context` under a fresh `unset-test-<hex>` tag and returns the tag. */
export function buildTestImage(dockerfile: string, context: string, call: Call): string {
  const tag = `unset-test-${randomBytes(8).toString("hex")}`;
  // Plain progress, not -q: on a failure BuildKit then prints the failing step's last log lines, where the real cause
  // is (a Go error, a fetch refused); -q prints only the Dockerfile excerpt (docker buildx 0.35.0, docker CLI 29.6.2).
  const built = docker(["build", "--progress=plain", "-t", tag, "-f", dockerfile, context], call);
  if (built.code !== 0) throw new Error(`${shown(dockerfile)} build failed: ${buildFailure(built.err)}`);
  return tag;
}

/** Removes one tag; the image goes only when no other build still tags it. Never -f, never an image id. */
export function removeTestImage(tag: string, call: Call): void {
  const removed = docker(["rmi", tag], call);
  if (removed.code !== 0) throw new Error(`docker rmi failed (${tag}): ${removed.err.trim().slice(-500)}`);
}

/** A Dockerfile by its repository path, or by its name when it lives outside the repository (a test's temp folder). */
function shown(dockerfile: string): string {
  const path = relative(REPOSITORY, dockerfile);
  return path.startsWith("..") ? basename(dockerfile) : path;
}

const FAILED_STEP = "\n------\n > ";
const MAX_FAILURE = 4_000;

/** From BuildKit's summary of the failing step to the end: the step's last log lines, the excerpt and the error. */
export function buildFailure(stderr: string): string {
  const from = stderr.lastIndexOf(FAILED_STEP);
  const failure = from === -1 ? stderr : stderr.slice(from + 1);
  return failure.length > MAX_FAILURE ? failure.slice(-MAX_FAILURE) : failure;
}
