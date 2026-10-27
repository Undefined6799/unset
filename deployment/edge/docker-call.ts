// The edge image tests' docker calls (P1.27t; moved here from both *.image.test.ts files by P1.27h, so the kill path
// has a unit test). Every call is killed at its own budget with SIGKILL, as P1.27k does for tests/support/docker.ts: a
// blocked spawnSync holds the event loop, so vitest's budget cannot stop it, and a hung daemon would hold the run until
// scripts/test/run.ts kills it whole at 600 s, failing with no name. A kill is a failure, never retried (Node 26
// child_process docs, "Synchronous process creation": `timeout`, `killSignal`, and `error.code` ETIMEDOUT on a kill).
// It imports nothing, as image-cleanup.ts does: no edge file outside a test may import even a Node built-in
// (scripts/lint/.dependency-cruiser.cjs lists no row for one), so each test passes in node:child_process's spawnSync,
// and the trusted tests that use it stay free of product test code.

export type Ran = { code: number; out: string; err: string };
/** The part of node:child_process's spawnSync this helper uses, with a string encoding. */
export type Spawn = (
  file: string,
  args: readonly string[],
  options: { encoding: "utf8"; maxBuffer: number; timeout: number; killSignal: "SIGKILL" },
) => { status: number | null; stdout: string; stderr: string; error?: Error };

// The docker CLI's commands that take a second word: the management and swarm commands, as tests/support/docker.ts
// lists them (`docker --help`, docker CLI 29.6.2; the same list in 29.9.2's Management and Swarm sections, swarm-only
// ones shown when the daemon is in swarm mode), plus the experimental `checkpoint`. Kept here, not imported, so this
// trusted helper stays free of product test code.
const GROUPS = new Set([
  "builder",
  "buildx",
  "checkpoint",
  "compose",
  "config",
  "container",
  "context",
  "image",
  "manifest",
  "network",
  "node",
  "plugin",
  "secret",
  "service",
  "stack",
  "swarm",
  "system",
  "volume",
]);
const WORD = /^[a-z][a-z-]*$/;

/**
 * Docker's subcommand in full (`run`, `image inspect`), never a flag or a reference: in `docker run busybox` the second
 * word is the image, so only a command in GROUPS takes one (P1.27h, N2).
 */
export function subcommand(args: readonly string[]): string {
  const [first, second] = args;
  if (first === undefined || !WORD.test(first)) return "";
  return GROUPS.has(first) && second !== undefined && WORD.test(second) ? `${first} ${second}` : first;
}

/** Runs `file args` to completion or to `timeoutMs`; a kill throws `<file> <subcommand> killed after <ms> ms`. */
export function runOrKill(spawn: Spawn, file: string, args: readonly string[], timeoutMs: number): Ran {
  // spawnSync reads a zero timeout as none at all, so only a positive one keeps the kill.
  if (!(timeoutMs > 0)) throw new RangeError(`timeoutMs must be positive, got ${timeoutMs}`);
  const result = spawn(file, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error(
      `${[file.slice(file.lastIndexOf("/") + 1), subcommand(args)].filter(Boolean).join(" ")} killed after ${timeoutMs} ms`,
    );
  }
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}

// The budgets (P1.27h, N1). A test that builds the edge image gets one build slot of 300 s, whose call is killed at
// 295 s (P1.27k's Amendment 2), plus CALL_MS for each other docker call it makes, killed at CALL_MS: so the kills of
// its calls always sum below its vitest budget, and the kill names the call before vitest's budget runs out. That
// budget stays under scripts/test/run.ts's 600 s (RUN_TIMEOUT_MS), which kills the whole run and names nothing. A daemon
// call (`run`, `rmi`) waits on the one daemon behind CI's parallel image builds, so it gets 50 s (P1.29o).
const RUN_MS = 600_000;
const BUILD_SLOT_MS = 300_000;
export const BUILD_CALL_MS = 295_000;
export const CALL_MS = 50_000;
/** Room in an afterAll for its own quick work after the removals. */
const HOOK_MARGIN_MS = 5_000;

/** The vitest budget of a test that builds the image once and makes `calls` other docker calls. */
export function buildTestBudget(calls: number): number {
  const budget = BUILD_SLOT_MS + calls * CALL_MS;
  if (budget >= RUN_MS) throw new RangeError(`${calls} calls after a build do not fit under run.ts's ${RUN_MS} ms`);
  return budget;
}

/** The vitest budget of an afterAll that removes up to `builds` tags, each removal killed at CALL_MS. */
export const removalBudget = (builds: number): number => builds * CALL_MS + HOOK_MARGIN_MS;
