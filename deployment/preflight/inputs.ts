// The preflight's inputs (P1.30, P1.30a): the command line, the compose files as one stack, the interpolation and
// service env files, and the readers and runners the checks use. Anything that keeps the preflight from judging the
// stack throws CannotRun or ParseError; index.ts turns either into exit 2.
import { lstatSync, readFileSync, readlinkSync, realpathSync, type Stats, statfsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import { undeclaredNetworks } from "./checks/networks.ts";
import type { Check, Env, Inputs, ManifestKind, MountedSecret, Run, Verifier } from "./checks/types.ts";
import {
  type Build,
  type Compose,
  type EnvValue,
  interpolatedNames,
  isHomeOrInterpolated,
  type Network,
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
  readlink?: (path: string) => string;
  statfs?: (path: string) => { type: number };
  uid?: number;
  checks?: readonly Check[];
  timeoutMs?: number;
  /** The process environment, where Compose would find overrides (P1.30a); `process.env` unless a test passes one. */
  environment?: Readonly<Record<string, string | undefined>>;
};

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

/**
 * Null only when the path does not exist; any other error (EACCES, ELOOP) throws, so C9 fails closed. It asks the
 * kernel through realpath(3) ("Synchronous realpath(3)", Node v26.10.0 doc/api/fs.md, fs.realpathSync.native; glibc
 * build). The JavaScript realpathSync joins each link target with path.resolve(previous, target), which collapses
 * `x/..` as text before following x, so a link through `x/..` read as a folder the kernel never reaches, and some
 * such links never resolved at all (verifier B3 on #700).
 */
const realpathOrNull = (path: string): string | null => {
  try {
    return realpathSync.native(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
};

export class CannotRun extends Error {}

/**
 * The accepted flags. None may be one Node reads after the script name (the `--env-file` family), and `--require` and
 * `--import` are banned too (cli.test.ts, ruling Amendment 3).
 */
export const CLI_OPTIONS = {
  env: { type: "string" },
  compose: { type: "string", multiple: true },
  "interpolation-env": { type: "string", multiple: true },
} as const;
const USAGE =
  "usage: --env dev|prod --compose <absolute file> [--compose <absolute file>...] " +
  "[--interpolation-env <absolute file>]";

function parseCli(argv: string[]): { env: Env; files: string[]; envFile: string | null } {
  // `node index.ts -- args` keeps the `--`; exactly one, first, is the call form and is dropped (Amendment 4). Any
  // other `--` is refused: parseArgs would read it as the start of positionals, and a trailing one ends nothing.
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
  // ProjectOptions.GetWorkingDir (cli/options.go, the same in v2.7.1 for 2.38.2 and v2.13.0 for v5.3.1). compose-go's
  // template/ package (interpolation) did change between those versions (ddb94f1 "fix: avoid eager default
  // interpolation", aa1ee1a "fix extraction of variables"; git log v2.7.1..v2.13.0 -- template/); P1.30l's revisit
  // trigger watches for such changes.
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
export type Loaded = { inputs: Inputs; configured: ConfiguredValues };

/** Inputs for the checks; anything that keeps the preflight from judging the stack throws CannotRun or ParseError. */
export function loadInputs(argv: string[], deps: Deps): Loaded {
  const readText = deps.readText ?? readTextOrNull;
  const environment = deps.environment ?? process.env;
  const { env, files, envFile } = parseCli(argv);
  refuseWhenSet(composeNames(Object.keys(environment)), environment);
  const { compose, mountedSecrets, interpolated } = loadCompose(files, readText);
  // Compose takes a shell value over the env file (Docker docs, "Interpolation"; compose-go Mapping.Merge).
  refuseWhenSet(interpolated, environment);
  const secretPaths: string[] = [];
  // Compose interpolates from its --env-file (our --interpolation-env), or else the `.env` in the project directory
  // (compose-go cli/options.go WithEnvFiles, v2.7.1 and v2.13.0); a name the file lacks becomes empty, as in Compose.
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
    readlink: deps.readlink ?? ((path) => readlinkSync(path)),
    statfs: deps.statfs ?? ((path) => statfsSync(path)),
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
