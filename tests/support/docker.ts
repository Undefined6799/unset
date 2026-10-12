// Docker for tests (P1.27k): every call carries a kill timeout. `spawnSync` blocks the event loop, so vitest's budget
// cannot stop a docker call that never returns; the job would run to its 30-minute limit (Codex on #655). Each call is
// killed with SIGKILL after its own budget instead, and the test fails naming the subcommand. Never retried (Node 26
// child_process docs, "Synchronous process creation": `timeout`, `killSignal`, and `error.code` ETIMEDOUT on a kill).
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

export type Ran = { code: number; out: string; err: string };
export type Call = {
  /** Required: how long this one call may take before it is killed. */
  readonly timeoutMs: number;
  readonly input?: string;
};

/** A call's kill budget inside a test or hook of `budgetMs`: just under it, so the kill fires first and names the call. */
export const killBefore = (budgetMs: number): number => budgetMs - 5_000;

/** Runs `file args` to completion or to `timeoutMs`; a kill throws `<file> <first arg> killed after <ms> ms`. */
export function runOrKill(file: string, args: readonly string[], { timeoutMs, input }: Call): Ran {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error(`${basename(file)} ${args[0] ?? ""} killed after ${timeoutMs} ms`);
  }
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}

export const docker = (args: readonly string[], call: Call): Ran => runOrKill("docker", args, call);
