// Docker for tests (P1.27k, P1.27g): every call carries a kill timeout. `spawnSync` blocks the event loop, so vitest's
// budget cannot stop a docker call that never returns; the run would go on until scripts/test/run.ts kills it whole at
// 600 s, naming nothing (Codex on #655). Each call is killed with SIGKILL after its own budget instead (the docker CLI
// forwards SIGTERM to the daemon and waits), and the test fails naming the subcommand. Never retried (Node 26
// child_process docs, "Synchronous process creation": `timeout`, `killSignal`, and `error.code` ETIMEDOUT on a kill).
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

export type Ran = { code: number; out: string; err: string };
export type Call = {
  /** Required: how long this one call may take before it is killed. */
  readonly timeoutMs: number;
  readonly input?: string;
};

const MARGIN_MS = 5_000;

/** A call's kill budget inside a test or hook of `budgetMs`: just under it, so the kill fires first and names the call. */
export function killBefore(budgetMs: number): number {
  if (!(budgetMs > MARGIN_MS)) throw new RangeError(`a budget of ${budgetMs} ms leaves no time for the call`);
  return budgetMs - MARGIN_MS;
}

// The docker CLI's commands that take a second word: the management commands and the swarm commands
// (`docker <command> --help` prints "Usage: docker <command> COMMAND", docker CLI 29.6.2), plus the experimental
// `checkpoint` (docs.docker.com, "docker checkpoint").
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

/** The subcommand in full (`run`, `image inspect`), never a flag or a reference such as an image name. */
export function subcommand(args: readonly string[]): string {
  const [first, second] = args;
  if (first === undefined || !WORD.test(first)) return "";
  return GROUPS.has(first) && second !== undefined && WORD.test(second) ? `${first} ${second}` : first;
}

/** Runs `file args` to completion or to `timeoutMs`; a kill throws `<file> <subcommand> killed after <ms> ms`. */
export function runOrKill(file: string, args: readonly string[], { timeoutMs, input }: Call): Ran {
  // spawnSync reads a zero timeout as none at all, so only a positive one keeps the kill.
  if (!(timeoutMs > 0)) throw new RangeError(`timeoutMs must be positive, got ${timeoutMs}`);
  const result = spawnSync(file, args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error(`${[basename(file), subcommand(args)].filter(Boolean).join(" ")} killed after ${timeoutMs} ms`);
  }
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}

export const docker = (args: readonly string[], call: Call): Ran => runOrKill("docker", args, call);

/**
 * Runs `body`, then `cleanup` whatever happened. A cleanup failure after a failing body is added to the body's error
 * instead of replacing it, so a hung removal never hides why the test failed; after a passing body it is thrown.
 */
export function withCleanup<T>(body: () => T, cleanup: () => void): T {
  let result: T;
  try {
    result = body();
    // An await in the body would resume after the cleanup removed what it uses, so only a synchronous body is taken.
    if (typeof (result as { then?: unknown } | null)?.then === "function") {
      throw new TypeError("withCleanup takes a synchronous body, not a promise");
    }
  } catch (failure) {
    try {
      cleanup();
    } catch (cleanupFailure) {
      throw new AggregateError(
        [failure, cleanupFailure],
        `${messageOf(failure)} (cleanup also failed: ${messageOf(cleanupFailure)})`,
      );
    }
    throw failure;
  }
  cleanup();
  return result;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
