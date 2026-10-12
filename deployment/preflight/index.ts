// The deploy preflight (P1.30; plan section 2 rule 23, sections 5.2, 5.3, 6.1): before any `compose up` on a server,
// one command checks the stack against every rule that, if broken, would leak data or cannot be fixed later.
//
//   node deployment/preflight/index.ts -- --env dev|prod --compose <absolute file> [--compose <absolute file>...]
//     [--interpolation-env <file>]
//
// The first --compose file's directory is the project directory: every relative path resolves from it. Interpolation
// reads the one --interpolation-env file (Compose's --env-file), or else the project directory's .env, as Compose
// does; the preflight refuses to run when its environment could change what Compose reads (P1.30a). The flag is not
// called --env-file because Node reads that flag anywhere before a literal `--`, even after the script name, and applies
// the file's NODE_OPTIONS before this code runs (Node v26.10.0 src/node_dotenv.cc:21-66, src/node.cc:982-1003; ruling
// 2026-10-12-preflight-compose-inputs, Amendment 3). The `--` before our arguments stops that scan too.
//
// Exit 0 when every check passes, 1 when one fails, 2 when the preflight cannot run (a bad argument, an unreadable or
// malformed compose or env file). There is no flag to skip a check. A check that throws fails; the network checks (C3 to C5,
// and C24) give up after 30 s and fail. Output is one `PASS|FAIL <id> <reason>` line per check and never a secret value: env files are
// read into SecretMaps, Compose is parsed here, never through `docker compose config`, and a reason that holds any
// configured value is withheld whole.
import { execFile } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, type Stats, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CHECKS } from "./checks/index.ts";
import { undeclaredNetworks } from "./checks/networks.ts";
import {
  type Check,
  type Env,
  type Inputs,
  type ManifestKind,
  MISSING,
  type MountedSecret,
  type Outcome,
  type Run,
  type Verifier,
} from "./checks/types.ts";

export type { Run };

import {
  type Build,
  type Compose,
  type EnvValue,
  interpolatedNames,
  isHomeOrInterpolated,
  type Network,
  ParseError,
  parseCompose,
  parseEnvFile,
  type Service,
} from "./compose-parse.ts";
import { ConfiguredValues, SecretMap } from "./secret-map.ts";

export type Deps = {
  /** The repository root: the lock, the cosign key and the verify-images CLI are read below it. */
  root: string;
  run: Run;
  readText?: (path: string) => string | null;
  stat?: (path: string) => Stats | null;
  lstat?: (path: string) => Stats | null;
  realpath?: (path: string) => string | null;
  uid?: number;
  checks?: readonly Check[];
  timeoutMs?: number;
  /** The process environment, where Compose would find overrides (P1.30a); `process.env` unless a test passes one. */
  environment?: Readonly<Record<string, string | undefined>>;
};
export type Result = { code: 0 | 1 | 2; lines: string[] };

const NETWORK_TIMEOUT_MS = 30_000;
const RETIREMENT_REPORT = "docs/human/retirement/retirement-check.json";
const INDEX_REF = /^[a-z0-9./-]+(?::[\w.-]+)?@sha256:[0-9a-f]{64}$/;

const readTextOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
const statOrNull = (path: string): Stats | null => {
  try {
    return statSync(path);
  } catch {
    return null;
  }
};

const lstatOrNull = (path: string): Stats | null => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

/** Null only when the path does not exist; any other error (EACCES, ELOOP) throws, so C9 fails closed. */
const realpathOrNull = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
};

class CannotRun extends Error {}

/**
 * The accepted flags. None may be one Node reads after the script name (the `--env-file` family), and `--require` and
 * `--import` are banned too (cli.test.ts, ruling Amendment 3).
 */
export const CLI_OPTIONS = {
  env: { type: "string" },
  compose: { type: "string", multiple: true },
  "interpolation-env": { type: "string", multiple: true },
} as const;
const USAGE = "usage: --env dev|prod --compose <file> [--compose <file>...] [--interpolation-env <file>]";

function parseCli(argv: string[]): { env: Env; files: string[]; envFile: string | null } {
  // `node index.ts -- args` keeps the `--`; exactly one, first, is the call form and is dropped (Amendment 4). Any other
  // `--` is refused: parseArgs would read it as the start of positionals, and a trailing one ends nothing.
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.includes("--")) throw new CannotRun(USAGE);
  let values: { env?: string; compose?: string[]; "interpolation-env"?: string[] };
  try {
    ({ values } = parseArgs({ args, options: CLI_OPTIONS, strict: true, allowPositionals: false }));
  } catch {
    throw new CannotRun(USAGE);
  }
  if (values.env !== "dev" && values.env !== "prod") throw new CannotRun("--env must be dev or prod");
  if (values.compose === undefined || values.compose.length === 0) throw new CannotRun("--compose is required");
  // Compose resolves a relative path against $PWD and Node against the physical cwd, which differ under a linked
  // directory, so the preflight would judge another tree than the one deployed (architecture, Amendment 3 of record
  // 2026-10-12-c9-secret-file-owner). Only an absolute, normal path means the same to both; it is walked as written.
  // normalize keeps a trailing slash, which names no file, so that is refused here too rather than echoed on read.
  if (!values.compose.every((file) => isAbsolute(file) && normalize(file) === file && !file.endsWith("/"))) {
    throw new CannotRun("--compose must be an absolute, normalised path");
  }
  return { env: values.env, files: values.compose, envFile: envFileOf(values["interpolation-env"]) };
}

/**
 * The one --interpolation-env file. Compose makes its --env-file absolute against $PWD (cmd/compose/compose.go,
 * `filepath.Abs`, in 2.38.2 and at :516-527 in v5.3.1) while Node resolves against the physical cwd, so only an
 * absolute, normal path names one file to both, as for --compose (P1.27a Amendment 3). Several are refused rather
 * than merged in Compose's order, and a leading `~` or a `$` is refused as in a compose path field: v5.3.1 expands
 * `~` there and 2.38.2 does not (ruling F2, F3.2).
 */
function envFileOf(given: string[] | undefined): string | null {
  if (given === undefined) return null;
  const [file, second] = given as [string, string?];
  if (second !== undefined) throw new CannotRun("--interpolation-env may be given once");
  if (isHomeOrInterpolated(file)) throw new CannotRun("--interpolation-env: a leading ~ or a $ is refused");
  if (!(isAbsolute(file) && normalize(file) === file && !file.endsWith("/"))) {
    throw new CannotRun("--interpolation-env must be an absolute, normalised path");
  }
  return file;
}

/**
 * Compose's own variables: COMPOSE_FILE, COMPOSE_ENV_FILES, COMPOSE_PROFILES and COMPOSE_DISABLE_ENV_FILE change which
 * compose or env files it reads (compose-go consts/consts.go, v2.13.0; Compose cmd/compose/compose.go, v5.3.1). The
 * stack uses none of them, so the whole prefix is refused and fails closed on keys a later Compose adds (ruling
 * 2026-10-12-preflight-compose-inputs, Amendment 1).
 */
const COMPOSE_PREFIX = "COMPOSE_";
const NODE_OPTIONS = "NODE_OPTIONS";
const composeNames = (names: Iterable<string>): string[] =>
  [...names].filter((name) => name.startsWith(COMPOSE_PREFIX));

/** Refuses to run when any of `names` is set, even empty, in the environment; only the name is printed. */
function refuseWhenSet(names: Iterable<string>, environment: Readonly<Record<string, string | undefined>>): void {
  for (const name of names) {
    if (environment[name] !== undefined) throw new CannotRun(`${name} is set in the environment`);
  }
}

/** The compose files as one stack: one project name, and each service defined in exactly one file. Exported for the
 * compose agreement test, which compares its resolved paths with `docker compose config`. */
export function loadCompose(files: string[], readText: (path: string) => string | null) {
  // With several files, every relative path resolves from the first file's directory, never from the file that names
  // it: "Relative paths are resolved based on the first Compose file's parent folder" (compose-spec spec.md, merging
  // multiple files; architecture record 2026-10-12-preflight-project-directory). The agreement test compares this with
  // `docker compose config`: v5.3.1 locally, and 2.38.2 on CI's ubuntu-24.04 runner (actions/runner-images,
  // images/ubuntu/toolsets/toolset-2404.json). Both take the first file's directory in compose-go's
  // ProjectOptions.GetWorkingDir (cli/options.go, the same in v2.7.1 for 2.38.2 and v2.13.0 for v5.3.1).
  const projectDir = dirname(files[0] as string);
  const services: Service[] = [];
  const networks: Network[] = [];
  const secretFiles: string[] = [];
  const secretFileByName = new Map<string, string>();
  const mounted = new Map<string, MountedSecret["mountedBy"]>();
  const interpolated = new Set<string>();
  let name: string | null = null;
  for (const file of files) {
    const text = readText(file);
    if (text === null) throw new CannotRun(`cannot read ${file}`);
    const compose = parseCompose(text, file);
    for (const used of interpolatedNames(text, file)) interpolated.add(used);
    if (compose.name !== null && name !== null && compose.name !== name) throw new CannotRun("project names differ");
    name = compose.name ?? name;
    for (const service of compose.services) {
      if (services.some((s) => s.name === service.name)) {
        throw new CannotRun(`service ${service.name} is defined twice`);
      }
      const mounts = service.mounts.map((m) =>
        m.type === "bind" && m.source !== null ? { ...m, source: resolve(projectDir, m.source) } : m,
      );
      const envFiles = service.envFiles.map((path) => resolve(projectDir, path));
      const build = service.build === null ? null : resolveBuild(service.build, projectDir);
      services.push({ ...service, mounts, envFiles, build });
    }
    // compose-parse refuses a service secret its own file does not declare, and a name declared in two files is
    // refused here (Compose would merge it, last file winning), so each name resolves within its own file (P1.27a).
    for (const [secret, path] of compose.secretFileByName) {
      if (secretFileByName.has(secret)) throw new CannotRun(`secret ${secret} is defined twice`);
      const users = compose.services
        .filter((service) => service.secrets.includes(secret))
        .map((service) => ({ service: service.name, user: service.hardening.user }));
      const absolute = resolve(projectDir, path);
      secretFileByName.set(secret, absolute);
      mounted.set(absolute, [...(mounted.get(absolute) ?? []), ...users]);
    }
    for (const network of compose.networks) {
      if (networks.some((n) => n.name === network.name))
        throw new CannotRun(`network ${network.name} is defined twice`);
      networks.push(network);
    }
    secretFiles.push(...compose.secretFiles.map((path) => resolve(projectDir, path)));
  }
  const compose: Compose = { name, services, networks, secretFiles, secretFileByName };
  const [undeclared] = undeclaredNetworks(compose);
  if (undeclared !== undefined) throw new CannotRun(undeclared);
  const mountedSecrets = [...mounted].map(([path, mountedBy]) => ({ path, mountedBy }));
  return { compose, mountedSecrets, interpolated };
}

/** A build's context resolves from the project directory, and its Dockerfile from the context (compose-spec build.md
 * "context" and "dockerfile"). */
function resolveBuild(build: Build, projectDir: string): Build {
  const context = resolve(projectDir, build.context);
  return { context, dockerfile: resolve(context, build.dockerfile) };
}

function readEnvFile(path: string, readText: (path: string) => string | null): [string, string][] {
  const text = readText(path);
  if (text === null) throw new CannotRun(`cannot read ${path}`);
  return parseEnvFile(text, path);
}

/** The checks' inputs, and every value the readers handed out on the way (P1.30m). */
type Loaded = { inputs: Inputs; configured: ConfiguredValues };

/** Inputs for the checks; anything that keeps the preflight from judging the stack throws CannotRun or ParseError. */
function loadInputs(argv: string[], deps: Deps): Loaded {
  const readText = deps.readText ?? readTextOrNull;
  const environment = deps.environment ?? process.env;
  const { env, files, envFile } = parseCli(argv);
  refuseWhenSet(composeNames(Object.keys(environment)), environment);
  const { compose, mountedSecrets, interpolated } = loadCompose(files, readText);
  // Compose takes a shell value over the env file (Docker docs, "Interpolation"; compose-go Mapping.Merge).
  refuseWhenSet(interpolated, environment);
  const secretPaths: string[] = [];
  // Compose interpolates from its --env-file (our --interpolation-env), or else the `.env` in the project directory (compose-go cli/options.go
  // WithEnvFiles, v2.7.1 and v2.13.0); a name the file lacks becomes empty, as in Compose.
  const interpolationPath = envFile ?? join(dirname(files[0] as string), ".env");
  const interpolationFile =
    envFile === null && readText(interpolationPath) === null ? [] : readEnvFile(interpolationPath, readText);
  if (interpolationFile.length > 0) secretPaths.push(interpolationPath);
  // Compose copies the env file's COMPOSE_* keys into its environment when the shell lacks them (cmd/compose/compose.go
  // setEnvWithDotEnv: v5.3.1 :683-719 copies the COMPOSE_* keys, 2.38.2 :677-699 copies every key), and compose-go
  // reads COMPOSE_PROJECT_NAME and the rest from that environment (cli/options.go :137-152, :219-229), so the file
  // must not set them either.
  // NODE_OPTIONS too: no stack service interpolates it (each sets it as a literal), and a wrapper that ever loaded the
  // file into a Node process would run it (ruling Amendment 3, belt).
  const [inFile] = interpolationFile
    .map(([name]) => name)
    .filter((name) => name === NODE_OPTIONS || name.startsWith(COMPOSE_PREFIX));
  if (inFile !== undefined) throw new CannotRun(`${inFile} is set in the env file`);
  const interpolation = new Map(interpolationFile);
  const resolveValue = (value: EnvValue): string =>
    "literal" in value ? value.literal : (interpolation.get(value.ref) ?? "");
  const serviceEnv = new Map<string, SecretMap>();
  const values = interpolationFile.map(([, value]) => value);
  for (const service of compose.services) {
    secretPaths.push(...service.envFiles);
    const fromFiles = service.envFiles.flatMap((path) => readEnvFile(path, readText));
    const fromCompose = service.environment.map(([key, value]): [string, string] => [key, resolveValue(value)]);
    serviceEnv.set(service.name, new SecretMap([...fromFiles, ...fromCompose]));
    values.push(...[...fromFiles, ...fromCompose].map(([, value]) => value));
  }
  const inputs: Inputs = {
    env,
    root: resolve(deps.root),
    compose,
    serviceEnv,
    secretPaths: [...new Set(secretPaths)],
    mountedSecrets,
    lockPath: join(deps.root, "deployment/images.lock.json"),
    cosignKeyPath: join(deps.root, "deployment/cosign.pub"),
    verify: verifier(deps),
    manifestKind: manifestKind(deps),
    run: deps.run,
    retirementReportPath: join(deps.root, RETIREMENT_REPORT),
    networkTablePath: join(deps.root, `deployment/networks.${env}.json`),
    edgeDir: join(deps.root, "deployment/edge"),
    readText,
    stat: deps.stat ?? statOrNull,
    lstat: deps.lstat ?? lstatOrNull,
    realpath: deps.realpath ?? realpathOrNull,
    uid: deps.uid ?? process.getuid?.() ?? -1,
  };
  return { inputs, configured: new ConfiguredValues(values) };
}

/** The verify-images CLI (P1.27q) by fixed path and arguments; its stderr holds one failure per line. */
function verifier(deps: Deps): Verifier {
  return async (lockPath, signal) => {
    const script = join(deps.root, "scripts/ci/verify-images.ts");
    const { code, stderr } = await deps.run(process.execPath, [script, lockPath], signal);
    if (code === 0) return { ok: true };
    const failures = stderr.split("\n").filter((line) => line.trim() !== "");
    return { ok: false, failures: failures.length > 0 ? failures : ["verify-images failed"] };
  };
}

/** `docker buildx imagetools inspect --raw` prints the reference's manifest as the registry serves it. */
function manifestKind(deps: Deps): ManifestKind {
  return async (ref, signal) => {
    if (!INDEX_REF.test(ref)) return "not a pinned reference";
    const { code, stdout } = await deps.run("docker", ["buildx", "imagetools", "inspect", "--raw", ref], signal);
    if (code !== 0) return "unreadable";
    const mediaType = (JSON.parse(stdout) as { mediaType?: unknown }).mediaType;
    return typeof mediaType === "string" ? mediaType : "unreadable";
  };
}

/** One check, failing closed: a throw is a failure, and a network check that outlasts its timeout fails. */
async function runCheck(check: Check, loaded: Loaded, timeoutMs: number): Promise<Outcome> {
  return withheldIfValued(await settle(check, loaded.inputs, timeoutMs), loaded.configured);
}

const WITHHELD = "reason withheld (it contained a configured value)";

/**
 * `outcome`, or, when its reason holds any value the run read, the same verdict with the reason withheld whole
 * (P1.30m). Replacing a value with its name leaked across maps, against a check's fixed text and through the template,
 * so nothing is printed in part, and there is no flag to see the reason. A value inside the replacement text itself
 * leaves the reason empty.
 */
function withheldIfValued(outcome: Outcome, configured: ConfiguredValues): Outcome {
  if (!configured.occurIn(outcome.reason)) return outcome;
  const reason = outcome.reason.startsWith(MISSING) ? `${MISSING}${WITHHELD}` : WITHHELD;
  return { pass: outcome.pass, reason: configured.occurIn(reason) ? "" : reason };
}

/** The check's outcome, a timeout for a network check past its deadline, or a failure for a throw. */
async function settle(check: Check, inputs: Inputs, timeoutMs: number): Promise<Outcome> {
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = new Promise<Outcome>((done) => {
    signal.addEventListener("abort", () => done({ pass: false, reason: "timed out" }), { once: true });
  });
  try {
    const outcome = Promise.resolve(check.run(inputs, signal));
    return await (check.network ? Promise.race([outcome, timedOut]) : outcome);
  } catch {
    return { pass: false, reason: "check error" };
  }
}

export async function preflight(argv: string[], deps: Deps): Promise<Result> {
  let loaded: Loaded;
  try {
    loaded = loadInputs(argv, deps);
  } catch (error) {
    if (error instanceof CannotRun || error instanceof ParseError)
      return { code: 2, lines: [`ERROR ${error.message}`] };
    return { code: 2, lines: ["ERROR the inputs could not be read"] };
  }
  const lines: string[] = [];
  let failed = false;
  for (const check of deps.checks ?? CHECKS) {
    const outcome = await runCheck(check, loaded, deps.timeoutMs ?? NETWORK_TIMEOUT_MS);
    failed ||= !outcome.pass;
    lines.push(`${outcome.pass ? "PASS" : "FAIL"} ${check.id} ${outcome.reason}`);
  }
  return { code: failed ? 1 : 0, lines };
}

/** Child processes with no shell and a bounded output; a spawn error reads as a failed run. */
const run: Run = (file, args, signal) =>
  new Promise((done) => {
    execFile(file, args, { signal, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const missing = (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
      done({
        code: error === null ? 0 : 1,
        stdout,
        stderr: error !== null && stderr === "" ? "run failed" : stderr,
        ...(missing ? { missing } : {}),
      });
    });
  });

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const { code, lines } = await preflight(process.argv.slice(2), { root, run });
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  process.exitCode = code;
}
