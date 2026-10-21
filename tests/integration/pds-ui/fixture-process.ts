// Fixture-only subprocess boundary: caller supplies fixed software/owned resource arguments.
import { spawn } from "node:child_process";
import { type Ran, subcommand } from "../../support/docker.ts";

export function fixtureProcess(
  file: string,
  args: readonly string[],
  signal: AbortSignal,
  timeoutMs: number,
  input?: string,
): Promise<Ran> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "",
      failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const abort = () => stop(new Error("fixture command canceled"));
    const timer = setTimeout(() => stop(new Error(`fixture ${subcommand(args)} deadline exceeded`)), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      out += part;
      if (out.length > 4_194_304) stop(new Error("fixture command output limit"));
    });
    child.stderr.on("data", (part: string) => {
      err = (err + part).slice(0, 4096);
    });
    const clear = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    child.once("error", () => {
      clear();
      reject(new Error("fixture command unavailable"));
    });
    child.once("close", (code) => {
      clear();
      if (failure) reject(failure);
      else resolve({ code: code ?? -1, out, err });
    });
    child.stdin.on("error", () => stop(new Error("fixture command input failed")));
    child.stdin.end(input);
    if (signal.aborted) abort();
  });
}

export function missingFixtureResource(result: Ran): boolean {
  return (
    result.code !== 0 &&
    /No such (?:object|container|network):|Error response from daemon: network [^\r\n]+ not found/i.test(result.err)
  );
}
