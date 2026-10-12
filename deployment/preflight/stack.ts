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
// interpolated name in the shell can change what the preflight read or what Compose runs. It lives beside the
// preflight under that folder's import row (P1.27w), and runs the preflight as a process, never by import, so its exit
// code is the gate.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

/** The only variables a child sees: where commands are, the home directory, and which Docker daemon to use. */
export const CHILD_ENV_NAMES = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH"];

const PREFLIGHT = resolve(import.meta.dirname, "index.ts");

export type Command = { file: string; args: string[] };
export type Plan = { env: Record<string, string>; commands: Command[] };
type Options = { action: "up" | "down"; env: string; files: string[]; envFile: string };

export class UsageError extends Error {}

/**
 * The caller's environment narrowed to CHILD_ENV_NAMES (an unset name stays unset), plus an explicitly empty
 * NODE_OPTIONS: Node v26.10.0 prefers a set NODE_OPTIONS, even an empty one, over one read from an --env-file
 * (src/node.cc:996-998), so a stray --env-file can never inject options into the preflight's Node.
 */
export function childEnv(from: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = { NODE_OPTIONS: "" };
  for (const name of CHILD_ENV_NAMES) {
    const value = from[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function parse(argv: string[]): Options {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        env: { type: "string" },
        compose: { type: "string", multiple: true },
        "interpolation-env": { type: "string", multiple: true },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch {
    throw new UsageError("usage: up|down --env dev --compose <file> [--compose <file>...] --interpolation-env <file>");
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
export function plan(argv: string[], from: Readonly<Record<string, string | undefined>>): Plan {
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
  return { env: childEnv(from), commands };
}

/** Runs each command with no shell, stopping at the first that does not exit 0; returns the exit code to use. */
export function run(
  { env, commands }: Plan,
  spawn: (file: string, args: string[], env: Record<string, string>) => number | null,
): number {
  for (const { file, args } of commands) {
    const code = spawn(file, args, env);
    if (code !== 0) return code ?? 1;
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = run(
      plan(process.argv.slice(2), process.env),
      (file, args, env) => spawnSync(file, args, { env, stdio: "inherit", shell: false }).status,
    );
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`stack: ${error.message}\n`);
    process.exitCode = 2;
  }
}
