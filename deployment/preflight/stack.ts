// The one way to start or stop a development stack (P1.27w; architecture records 2026-10-12-preflight-compose-inputs,
// items F3.1, F3.3 and F3.5 and Amendment 3, and 2026-10-12-stack-wrapper-location):
//
//   node deployment/preflight/stack.ts up|down --env dev|local --compose <file> [--compose <file>...]
//     --interpolation-env <file>
//
// `up` runs the deploy preflight as a child process with exactly these compose files and interpolation env file, all
// after a `--` so Node reads none of them as its own flags (Node loads an --env-file it finds in argv, Amendment 3),
// and stops on any non-zero exit. It then runs `docker compose … --env-file <file> up -d --build` with the same files
// in the same order. `down` stops the stack and never passes -v, so the data volumes survive. A COMPOSE_* variable in
// the caller's shell is refused outright, and both children get an environment built from an allowlist only, so no
// interpolated name in the shell can change what the preflight read or what Compose runs. Both children talk to a
// Docker daemon on this host only: C9, C18 and C26 walk this machine's files, and a remote daemon would bind files of
// another (architecture record 2026-10-12-workspace-imports-and-remote-daemon (2)). It lives beside the
// preflight under that folder's import row (P1.27w), and runs the preflight as a process, never by import, so its exit
// code is the gate.
//
// Under --env local (P1.34d item 15), `up` then runs served-leaf.ts, also as a process, to prove the edge serves the
// leaf copy the preflight judged; if that check does not pass, the wrapper runs `down` and fails.
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { hostWalk, localDockerHost, UsageError, type WalkInputs } from "../../shared/host-pin/index.ts";

/** The only variables a child sees: where commands are, the home directory, and how the Docker CLI is configured. */
export const CHILD_ENV_NAMES = ["PATH", "HOME", "DOCKER_CONFIG", "DOCKER_CERT_PATH"];

const PREFLIGHT = resolve(import.meta.dirname, "index.ts");
const SERVED_LEAF = resolve(import.meta.dirname, "served-leaf.ts");

/**
 * A program to run; `name` is the fixed label reasons use, so no reason prints a path (P1.34s, nit 4). `undo` runs when
 * this command fails in any way, before the failure is reported.
 */
export type Command = { name: string; file: string; args: string[]; undo?: Command };
/** What spawnSync reports about a finished child: a missing program is `error`, a kill is `signal`. */
export type Exit = { status: number | null; signal: NodeJS.Signals | null; error?: Error };
/** How `run` starts a command and asks the daemon its name; the one double in the tests. */
export type Runner = {
  spawn: (file: string, args: string[], env: Record<string, string>) => Exit;
  capture: (file: string, args: string[], env: Record<string, string>, timeoutMs: number) => Exit & { stdout: string };
  hostname: string;
};

/** How long `docker info` may take before the wrapper gives up on the daemon (RE-1). */
export const DOCKER_INFO_DEADLINE_MS = 10_000;
export type Plan = { env: Record<string, string>; commands: Command[] };
/** The wrapper's own flags: none of them is one Node also reads (`--env-file*`, `--require*`, `--import*`). */
export const WRAPPER_OPTIONS = {
  env: { type: "string" },
  compose: { type: "string", multiple: true },
  "interpolation-env": { type: "string", multiple: true },
} as const;
type Options = { action: "up" | "down"; env: "dev" | "local"; files: string[]; envFile: string };

export { UsageError };

const USAGE = "usage: up|down --env dev|local --compose <file> [--compose <file>...] --interpolation-env <file>";

/** A child that could not start or was killed: a fixed reason naming the program, never its arguments (DC-4). */
export class StackError extends Error {}

/**
 * The caller's environment narrowed to CHILD_ENV_NAMES (an unset name stays unset), plus DOCKER_HOST, always set: an
 * explicit DOCKER_HOST overrides any currentContext in DOCKER_CONFIG/config.json (Docker CLI 29.8.2, checked by a test),
 * so a stored remote context cannot win. And an explicitly empty NODE_OPTIONS: Node v26.10.0 prefers a set
 * NODE_OPTIONS, even an empty one, over one read from an --env-file (src/node.cc:996-998), so a stray --env-file can
 * never inject options into the preflight's Node.
 */
export function childEnv(
  from: Readonly<Record<string, string | undefined>>,
  inputs: WalkInputs = hostWalk,
): Record<string, string> {
  const env: Record<string, string> = { NODE_OPTIONS: "", DOCKER_HOST: localDockerHost(from, inputs) };
  for (const name of CHILD_ENV_NAMES) {
    const value = from[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function parse(argv: string[]): Options {
  // One leading `--` is how callers keep Node off the arguments (pitfall node-reads-env-file-after-script); any other
  // `--` would end parseArgs' options early, so it is refused, as the preflight does (index.ts).
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.includes("--")) throw new UsageError(USAGE);
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, options: WRAPPER_OPTIONS, strict: true, allowPositionals: true });
  } catch {
    throw new UsageError(USAGE);
  }
  const { values, positionals } = parsed;
  const [action, ...rest] = positionals;
  if ((action !== "up" && action !== "down") || rest.length > 0) throw new UsageError("the action is up or down");
  if (values.env !== "dev" && values.env !== "local") throw new UsageError("--env must be dev or local");
  const files = (values.compose as string[] | undefined) ?? [];
  if (files.length === 0) throw new UsageError("--compose is required");
  const envFiles = (values["interpolation-env"] as string[] | undefined) ?? [];
  if (envFiles.length !== 1) throw new UsageError("--interpolation-env is required exactly once");
  // Resolved once against the physical cwd (getcwd), never $PWD, and that one string goes to both children (C9 record,
  // Amendment 3 and its addendum).
  const physical = (path: string): string => resolve(process.cwd(), path);
  return { action, env: values.env, files: files.map(physical), envFile: physical(envFiles[0] as string) };
}

/** Refuses a caller who set any COMPOSE_* variable, naming it (never its value), rather than dropping it unseen. */
function refuseComposeVariables(from: Readonly<Record<string, string | undefined>>): void {
  const set = Object.keys(from).filter((name) => name.startsWith("COMPOSE_") && from[name] !== undefined);
  if (set.length > 0) throw new UsageError(`unset ${set.sort().join(", ")}: Compose reads only the files given here`);
}

/** What `argv` runs, in order, and the one environment every command gets. */
export function plan(
  argv: string[],
  from: Readonly<Record<string, string | undefined>>,
  inputs: WalkInputs = hostWalk,
): Plan {
  refuseComposeVariables(from);
  const { action, env, files, envFile } = parse(argv);
  const compose = ["compose", ...files.flatMap((f) => ["-f", f]), "--env-file", envFile];
  const down: Command = { name: "docker", file: "docker", args: [...compose, "down"] };
  const leafCheck: Command = {
    name: "the leaf check",
    file: process.execPath,
    args: [SERVED_LEAF, "--env", env],
    undo: down,
  };
  const commands: Command[] =
    action === "up"
      ? [
          {
            name: "the preflight",
            file: process.execPath,
            args: [
              PREFLIGHT,
              "--",
              "--env",
              env,
              ...files.flatMap((f) => ["--compose", f]),
              "--interpolation-env",
              envFile,
            ],
          },
          { name: "docker", file: "docker", args: [...compose, "up", "-d", "--build"] },
          ...(env === "local" ? [leafCheck] : []),
        ]
      : [down];
  return { env: childEnv(from, inputs), commands };
}

/**
 * Refuses a daemon that names another machine: a unix socket forwarded from elsewhere passes localDockerHost. An
 * operator misconfiguration, not an attacker defence (record (2), belt). A daemon that does not answer stops the run.
 */
function refuseRemoteDaemon(env: Record<string, string>, runner: Runner): number {
  const args = ["info", "--format", "{{.OperatingSystem}}|{{.Name}}"];
  const info = runner.capture("docker", args, env, DOCKER_INFO_DEADLINE_MS);
  const status = exitCode("docker", info);
  if (status !== 0) return status;
  const name = info.stdout.trim().split("|").at(-1);
  if (name !== runner.hostname) throw new UsageError("the Docker daemon is not on this machine");
  return 0;
}

/**
 * Checks the daemon is on this machine, then runs each command with no shell, stopping at the first that does not exit
 * 0; returns the exit code to use.
 */
export function run({ env, commands }: Plan, runner: Runner): number {
  const daemon = refuseRemoteDaemon(env, runner);
  if (daemon !== 0) return daemon;
  for (const command of commands) {
    const code = runOrUndo(command, env, runner);
    if (code !== 0) return code;
  }
  return 0;
}

/** Runs one command; when it fails in any way and has an `undo`, runs that first, then reports the failure. */
function runOrUndo({ name, file, args, undo }: Command, env: Record<string, string>, runner: Runner): number {
  let code: number;
  try {
    code = exitCode(name, runner.spawn(file, args, env));
  } catch (error) {
    if (undo !== undefined) runner.spawn(undo.file, undo.args, env);
    throw error;
  }
  if (code !== 0 && undo !== undefined) runner.spawn(undo.file, undo.args, env);
  return code;
}

/**
 * The child's exit status, or a fixed reason naming it when it never ran, ran out of time or was killed (spawnSync
 * leaves status null then). A timeout is named as one: spawnSync reports it as an ETIMEDOUT error with the kill
 * signal set (Node v26.10.0, checked by stack.test.ts), and the signal alone would read as an unrelated kill.
 */
function exitCode(name: string, { status, signal, error }: Exit): number {
  if ((error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT")
    throw new StackError(`${name} did not answer in time`);
  if (error !== undefined && signal === null) throw new StackError(`${name} could not be started`);
  if (signal !== null) throw new StackError(`${name} was stopped by ${signal}`);
  return status ?? 1;
}

/** Real child processes, with no shell. A capture past its deadline is killed with SIGKILL, which no child can trap. */
export const processRunner: Runner = {
  spawn: (file, args, env) => {
    const result = spawnSync(file, args, { env, stdio: "inherit", shell: false });
    const exit = { status: result.status, signal: result.signal };
    return result.error === undefined ? exit : { ...exit, error: result.error };
  },
  capture: (file, args, env, timeoutMs) => {
    const result = spawnSync(file, args, {
      env,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
      shell: false,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    const exit = { status: result.status, signal: result.signal, stdout: result.stdout ?? "" };
    return result.error === undefined ? exit : { ...exit, error: result.error };
  },
  hostname: hostname(),
};

/** Runs the wrapper; a refusal or a failed child prints one fixed line and exits 2. */
export function main(
  argv: string[],
  from: Readonly<Record<string, string | undefined>>,
  runner: Runner,
  write: (line: string) => void,
  inputs: WalkInputs = hostWalk,
): number {
  try {
    return run(plan(argv, from, inputs), runner);
  } catch (error) {
    if (!(error instanceof UsageError || error instanceof StackError)) throw error;
    write(`stack: ${error.message}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2), process.env, processRunner, (line) => process.stderr.write(line));
}
