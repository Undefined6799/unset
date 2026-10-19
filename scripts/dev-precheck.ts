// P1.29s: the check `dev:up` / `local:up` run before `docker compose up`. It refuses a production PDS host and a
// foreign describeServer DID (the old prototype), then runs the deploy preflight as a child. It creates no account
// and does not call the email-token reader (ADR 0023).
//
// describeServer: lexicon `com.atproto.server.describeServer` (did required on current main;
// https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/server/describeServer.json).
// @atproto/pds 0.5.37 sets the service DID to PDS_SERVICE_DID or `did:web:${hostname}`
// (https://unpkg.com/@atproto/pds@0.5.37/dist/config/config.js).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

export const PRODUCTION_HOST = "unset.ac";
export const DEV_HOST = "0x40.space";
/** L2's `.localhost` pin (RFC 6761): a throwaway PDS, never a production name. */
export const LOCAL_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost$/;

export const PRODUCTION_HOST_CODE = "precheck.production_host";
export const UNKNOWN_DID_CODE = "precheck.unknown_pds_did";

export const CLI_OPTIONS = {
  env: { type: "string" },
  compose: { type: "string", multiple: true },
  "interpolation-env": { type: "string", multiple: true },
} as const;

const USAGE = "usage: --env local|dev --compose <file> [--compose <file>...] --interpolation-env <file>";
const PREFLIGHT = resolve(import.meta.dirname, "../deployment/preflight/index.ts");
const DESCRIBE = "/xrpc/com.atproto.server.describeServer";
const DESCRIBE_MS = 5_000;

export type EnvName = "local" | "dev";
/** `null` is unreachable (first boot). A parsed body may omit `did` (absent). */
export type DescribeServer = { did?: string } | null;
export type Options = { env: EnvName; files: string[]; envFile: string };

export class PrecheckError extends Error {}

/** A hostname as DNS compares it: lower case, without a port or the root's trailing dot. */
export const normalHost = (host: string): string => host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

/** The service DID @atproto/pds 0.5.37 uses when PDS_SERVICE_DID is unset. */
export const expectedDid = (hostname: string): string => `did:web:${normalHost(hostname)}`;

/**
 * Step 1: env is local or dev, and the PDS hostname is that env's pin. `unset.ac` is always production. A name that
 * is not the pin is refused with the same code: the wrapper must not start against the wrong host.
 */
export function hostnamePin(env: EnvName, host: string): "ok" | typeof PRODUCTION_HOST_CODE {
  const name = normalHost(host);
  if (name === "" || name === PRODUCTION_HOST) return PRODUCTION_HOST_CODE;
  switch (env) {
    case "local":
      return LOCAL_HOST.test(name) ? "ok" : PRODUCTION_HOST_CODE;
    case "dev":
      return name === DEV_HOST ? "ok" : PRODUCTION_HOST_CODE;
    default: {
      const unexpected: never = env;
      return unexpected;
    }
  }
}

/** Step 2: a present DID that is not `did:web:<hostname>` is the old prototype (or another PDS). */
export function didVerdict(hostname: string, answer: DescribeServer): "ok" | typeof UNKNOWN_DID_CODE {
  if (answer === null) return "ok";
  const did = answer.did;
  if (did === undefined || did === "") return "ok";
  return did === expectedDid(hostname) ? "ok" : UNKNOWN_DID_CODE;
}

export type Run = {
  env: EnvName;
  pdsHostname: string;
  describeServer: (hostname: string) => Promise<DescribeServer>;
  preflight: () => Promise<number>;
};

/**
 * The four-step algorithm. Callers inject describeServer and preflight (TE-1). Nothing here creates an account or
 * writes a file.
 */
export async function precheck(input: Run): Promise<{ code: number; reason?: string }> {
  const pin = hostnamePin(input.env, input.pdsHostname);
  if (pin !== "ok") return { code: 2, reason: pin };
  const did = didVerdict(input.pdsHostname, await input.describeServer(normalHost(input.pdsHostname)));
  if (did !== "ok") return { code: 2, reason: did };
  const code = await input.preflight();
  return code === 0 ? { code: 0 } : { code: 2 };
}

/** PDS_HOSTNAME from a strict KEY=VALUE env file (the same form the preflight admits). Duplicate keys refuse. */
export function pdsHostnameFromEnv(text: string): string | null {
  let found: string | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const match = /^PDS_HOSTNAME=(?:'([^']*)'|([^\s$#'"]*))$/.exec(line);
    if (match === null) continue;
    if (found !== null) return null;
    found = match[1] ?? match[2] ?? "";
  }
  return found;
}

export function parse(argv: string[]): Options {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.includes("--")) throw new PrecheckError(USAGE);
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, options: CLI_OPTIONS, strict: true, allowPositionals: false });
  } catch {
    throw new PrecheckError(USAGE);
  }
  const { values } = parsed;
  if (values.env !== "dev" && values.env !== "local") throw new PrecheckError(USAGE);
  const files = (values.compose as string[] | undefined) ?? [];
  if (files.length === 0) throw new PrecheckError(USAGE);
  const envFiles = (values["interpolation-env"] as string[] | undefined) ?? [];
  if (envFiles.length !== 1) throw new PrecheckError(USAGE);
  const physical = (path: string): string => resolve(process.cwd(), path);
  return { env: values.env, files: files.map(physical), envFile: physical(envFiles[0] as string) };
}

export type Deps = {
  readEnvText: (path: string) => string;
  describeServer: (hostname: string) => Promise<DescribeServer>;
  preflight: (args: string[]) => Promise<number>;
};

/** Parses argv, reads PDS_HOSTNAME, then runs the algorithm. Reasons are fixed codes, never a host or DID (SE-7). */
export async function main(argv: string[], deps: Deps, write: (line: string) => void): Promise<number> {
  try {
    const options = parse(argv);
    const hostname = pdsHostnameFromEnv(deps.readEnvText(options.envFile));
    if (hostname === null) {
      write(`${PRODUCTION_HOST_CODE}\n`);
      return 2;
    }
    const flags = [
      "--env",
      options.env,
      ...options.files.flatMap((file) => ["--compose", file]),
      "--interpolation-env",
      options.envFile,
    ];
    const result = await precheck({
      env: options.env,
      pdsHostname: hostname,
      describeServer: deps.describeServer,
      preflight: () => deps.preflight(flags),
    });
    if (result.reason !== undefined) write(`${result.reason}\n`);
    return result.code;
  } catch (error) {
    if (!(error instanceof PrecheckError)) throw error;
    write(`${error.message}\n`);
    return 2;
  }
}

/** GET describeServer; unreachable or an unreadable body is absent. Hostname is already the env pin. */
export async function fetchDescribeServer(hostname: string): Promise<DescribeServer> {
  try {
    const response = await fetch(`https://${hostname}${DESCRIBE}`, {
      redirect: "error",
      signal: AbortSignal.timeout(DESCRIBE_MS),
    });
    if (!response.ok) return null;
    const parsed: unknown = await response.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const did = (parsed as { did?: unknown }).did;
    return typeof did === "string" ? { did } : {};
  } catch {
    return null;
  }
}

const processDeps: Deps = {
  readEnvText: (path) => readFileSync(path, "utf8"),
  describeServer: fetchDescribeServer,
  preflight: async (args) => {
    const result = spawnSync(process.execPath, [PREFLIGHT, "--", ...args], { stdio: "inherit", shell: false });
    return result.status ?? 1;
  },
};

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), processDeps, (line) => process.stderr.write(line));
}
