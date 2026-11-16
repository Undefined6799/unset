// Creates the object store's buckets after `up` (P2.18s; ADR 0050 Decisions 1 and 2): through the store's own shell,
// `docker compose … exec -T objects weed shell`, never an S3 key, since no identity holds Admin. The stack wrapper
// (stack.ts) runs it as a process after `docker compose up -d`, with the same compose files and interpolation file, and
// stops the stack when it fails.
//
//   node deployment/preflight/objects-buckets.ts -- --compose <file> [--compose <file>...] --interpolation-env <file>
//
// It waits for the store's health endpoint (the image's own HEALTHCHECK URL, objects.Dockerfile), lists the buckets,
// creates each missing one with `s3.bucket.create -name <name>`, and lists again to prove both exist. It never passes
// -withLock, which turns versioning and object lock on (weed shell `help s3.bucket.create`, SeaweedFS 4.53). What weed
// prints is never echoed: it prints bucket names and sizes only, and this prints fixed lines (SE-7).
//
// weed shell reads commands from stdin and, on 4.53 (checked 2026-11-16): `s3.bucket.list` prints one line per bucket,
// two spaces then the name then a tab; `s3.bucket.create` on an existing bucket exits 1 ("already exists"), so a bucket
// is created only when the list lacks it; an unknown command exits 1.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

/** The buckets ADR 0041 names: the app's private objects and the PDS's blobstore. */
export const BUCKETS = ["unset-private", "unset-pds"] as const;
/** The whole setup, the store's start included, ends by this (RE-1); one call never outlives it. */
export const DEADLINE_MS = 90_000;
const CALL_MS = 30_000;
const PAUSE_MS = 1_000;
const HEALTH = ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8333/healthz"];

/** One finished `docker` call; `status` is null when it never ran, ran out of time or was killed. */
export type Call = { status: number | null; stdout: string };
/** How the setup runs docker, keeps time and waits; the one double in the tests (TE-1: Docker is unmanaged). */
export type Docker = {
  run: (args: string[], input: string, timeoutMs: number) => Call;
  now: () => number;
  sleep: (ms: number) => void;
};

/** The bucket names in `s3.bucket.list`'s output. */
export function listedBuckets(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => /^ {2}([a-z0-9][a-z0-9.-]*)\t/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** Why the buckets could not be made sure of, or null when both exist. */
export function ensureBuckets(compose: string[], docker: Docker): string | null {
  const deadline = docker.now() + DEADLINE_MS;
  const left = () => Math.min(CALL_MS, Math.floor(deadline - docker.now()));
  const exec = (command: string[], input = ""): Call | null => {
    const budget = left();
    return budget > 0 ? docker.run([...compose, "exec", "-T", "objects", ...command], input, budget) : null;
  };
  const shell = (line: string) => exec(["weed", "shell"], `${line}\n`);
  for (;;) {
    const health = exec(HEALTH);
    if (health === null) return "the object store did not become healthy in time";
    if (health.status === 0) break;
    docker.sleep(Math.min(PAUSE_MS, Math.max(0, deadline - docker.now())));
  }
  const before = shell("s3.bucket.list");
  if (before?.status !== 0) return "the object store's shell could not list the buckets";
  for (const name of BUCKETS.filter((bucket) => !listedBuckets(before.stdout).includes(bucket))) {
    if (shell(`s3.bucket.create -name ${name}`)?.status !== 0) return `the object store did not create ${name}`;
  }
  const after = shell("s3.bucket.list");
  if (after?.status !== 0) return "the object store's shell could not list the buckets";
  const missing = BUCKETS.filter((bucket) => !listedBuckets(after.stdout).includes(bucket));
  return missing.length === 0 ? null : `the object store lacks ${missing.join(", ")} after setup`;
}

/** The compose arguments from this script's flags, the stack wrapper's own spelling of them. */
export function composeArgs(argv: string[]): string[] {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args,
    options: { compose: { type: "string", multiple: true }, "interpolation-env": { type: "string" } },
    strict: true,
  });
  const files = values.compose ?? [];
  const envFile = values["interpolation-env"];
  if (files.length === 0 || envFile === undefined)
    throw new Error("usage: --compose <file>... --interpolation-env <file>");
  return ["compose", ...files.flatMap((file) => ["-f", file]), "--env-file", envFile];
}

const PAUSE = new Int32Array(new SharedArrayBuffer(4));

/**
 * Real docker, with no shell; a call past its deadline is killed with SIGKILL. Its stderr is captured and dropped,
 * never echoed.
 */
export const processDocker: Docker = {
  run: (args, input, timeoutMs) => {
    const result = spawnSync("docker", args, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    return { status: result.error === undefined ? result.status : null, stdout: result.stdout ?? "" };
  },
  now: () => performance.now(),
  sleep: (ms) => {
    Atomics.wait(PAUSE, 0, 0, ms);
  },
};

if (import.meta.main) {
  try {
    const problem = ensureBuckets(composeArgs(process.argv.slice(2)), processDocker);
    process.stderr.write(problem === null ? "objects: buckets ready\n" : `objects: ${problem}\n`);
    process.exitCode = problem === null ? 0 : 1;
  } catch (error) {
    process.stderr.write(`objects: ${error instanceof Error ? error.message : "setup failed"}\n`);
    process.exitCode = 2;
  }
}
