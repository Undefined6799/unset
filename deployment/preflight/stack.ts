// The one way to start or stop a development stack (P1.27w; architecture records 2026-10-12-preflight-compose-inputs,
// items F3.1, F3.3 and F3.5 and Amendment 3, and 2026-10-12-stack-wrapper-location):
//
//   node deployment/preflight/stack.ts up|down --env dev --compose <file> [--compose <file>...]
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
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

/** The only variables a child sees: where commands are, the home directory, and how the Docker CLI is configured. */
export const CHILD_ENV_NAMES = ["PATH", "HOME", "DOCKER_CONFIG", "DOCKER_CERT_PATH"];

/** The daemon both children use when the caller sets no DOCKER_HOST: the local root daemon. */
export const DEFAULT_DOCKER_HOST = "unix:///var/run/docker.sock";

const PREFLIGHT = resolve(import.meta.dirname, "index.ts");

export type Command = { file: string; args: string[] };
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
type Options = { action: "up" | "down"; env: string; files: string[]; envFile: string };

const USAGE = "usage: up|down --env dev --compose <file> [--compose <file>...] --interpolation-env <file>";

export class UsageError extends Error {}
/** A child that could not start or was killed: a fixed reason naming the program, never its arguments (DC-4). */
export class StackError extends Error {}

/**
 * The caller's DOCKER_HOST, or the local default, if it names a socket on this machine: `unix://` and an absolute path
 * whose lstat is a socket (a rootless /run/user/<uid>/docker.sock included). tcp://, ssh://, npipe:// and anything else
 * are refused with a fixed reason that never echoes the value.
 */
export function localDockerHost(
  from: Readonly<Record<string, string | undefined>>,
  isSocket: (path: string) => boolean,
): string {
  const host = from.DOCKER_HOST ?? DEFAULT_DOCKER_HOST;
  const path = host.startsWith("unix://") ? host.slice("unix://".length) : "";
  if (!isAbsolute(path) || !isSocket(path)) throw new UsageError("DOCKER_HOST must be a Docker socket on this machine");
  return host;
}

const lstatIsSocket = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isSocket() ?? false;

/**
 * The caller's environment narrowed to CHILD_ENV_NAMES (an unset name stays unset), plus DOCKER_HOST, always set: an
 * explicit DOCKER_HOST overrides any currentContext in DOCKER_CONFIG/config.json (Docker CLI 29.8.2, checked by a test),
 * so a stored remote context cannot win. And an explicitly empty NODE_OPTIONS: Node v26.10.0 prefers a set
 * NODE_OPTIONS, even an empty one, over one read from an --env-file (src/node.cc:996-998), so a stray --env-file can
 * never inject options into the preflight's Node.
 */
export function childEnv(
  from: Readonly<Record<string, string | undefined>>,
  isSocket: (path: string) => boolean = lstatIsSocket,
): Record<string, string> {
  const env: Record<string, string> = { NODE_OPTIONS: "", DOCKER_HOST: localDockerHost(from, isSocket) };
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
    parsed = parseArgs({
      args,
      options: {
        env: { type: "string" },
        compose: { type: "string", multiple: true },
        "interpolation-env": { type: "string", multiple: true },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch {
    throw new UsageError(USAGE);
  }
  const { values, positionals } = parsed;
  const [action, ...rest] = positionals;
  if ((action !== "up" && action !== "down") || rest.length > 0) throw new UsageError("the action is up or down");
  if (values.env !== "dev") throw new UsageError("--env must be dev");
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
  isSocket: (path: string) => boolean = lstatIsSocket,
): Plan {
  refuseComposeVariables(from);
  const { action, env, files, envFile } = parse(argv);
  const compose = ["compose", ...files.flatMap((f) => ["-f", f]), "--env-file", envFile];
  const commands: Command[] =
    action === "up"
      ? [
          {
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
          { file: "docker", args: [...compose, "up", "-d", "--build"] },
        ]
      : [{ file: "docker", args: [...compose, "down"] }];
  return { env: childEnv(from, isSocket), commands };
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
  for (const { file, args } of commands) {
    const code = exitCode(file, runner.spawn(file, args, env));
    if (code !== 0) return code;
  }
  return 0;
}

/** The child's exit status, or a fixed reason when it never ran or was killed (spawnSync leaves status null then). */
function exitCode(file: string, { status, signal, error }: Exit): number {
  if (error !== undefined && signal === null) throw new StackError(`${file} could not be started`);
  if (signal !== null) throw new StackError(`${file} was stopped by ${signal}`);
  return status ?? 1;
}

if (import.meta.main) {
  try {
    process.exitCode = run(plan(process.argv.slice(2), process.env), {
      spawn: (file, args, env) => spawnSync(file, args, { env, stdio: "inherit", shell: false }),
      capture: (file, args, env, timeoutMs) => {
        const result = spawnSync(file, args, {
          env,
          stdio: ["ignore", "pipe", "inherit"],
          encoding: "utf8",
          shell: false,
          timeout: timeoutMs,
        });
        const exit = { status: result.status, signal: result.signal, stdout: result.stdout ?? "" };
        return result.error === undefined ? exit : { ...exit, error: result.error };
      },
      hostname: hostname(),
    });
  } catch (error) {
    if (!(error instanceof UsageError || error instanceof StackError)) throw error;
    process.stderr.write(`stack: ${error.message}\n`);
    process.exitCode = 2;
  }
}
