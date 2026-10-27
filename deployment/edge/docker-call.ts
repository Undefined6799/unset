// The edge image tests' docker calls (P1.27t; moved here from both *.image.test.ts files by P1.27h, so the kill path
// can have a unit test). Every call is killed at its own budget with SIGKILL, as P1.27k does for tests/support/docker.ts: a
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

/** Docker's subcommand in full: up to two leading words (`run`, `image inspect`), never a flag or a reference. */
export function subcommand(args: readonly string[]): string {
  const end = args.findIndex((arg) => !/^[a-z][a-z-]*$/.test(arg));
  return args.slice(0, Math.min(end === -1 ? args.length : end, 2)).join(" ");
}

/** Runs `file args` to completion or to `timeoutMs`; a kill throws `<file> <subcommand> killed after <ms> ms`. */
export function runOrKill(spawn: Spawn, file: string, args: readonly string[], timeoutMs: number): Ran {
  const result = spawn(file, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error(`${file.slice(file.lastIndexOf("/") + 1)} ${subcommand(args)} killed after ${timeoutMs} ms`);
  }
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? String(result.error ?? "") };
}
