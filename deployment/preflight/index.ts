// The deploy preflight (P1.30; plan section 2 rule 23, sections 5.2, 5.3, 6.1): before any `compose up` on a server,
// one command checks the stack against every rule that, if broken, would leak data or cannot be fixed later.
//
//   node deployment/preflight/index.ts --env dev|prod --compose <file> [--compose <file>...]
//
// Exit 0 when every check passes, 1 when one fails, 2 when the preflight cannot run (a bad argument, an unreadable or
// malformed compose or env file). There is no flag to skip a check. A check that throws fails; C3, C4 and C5 give up
// after 30 s and fail. Output is one `PASS|FAIL <id> <reason>` line per check and never a secret value: env files are
// read into SecretMaps, and Compose is parsed here, never through `docker compose config`.
import { execFile } from "node:child_process";
import { readFileSync, type Stats, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CHECKS } from "./checks/index.ts";
import type { Check, Env, Inputs, ManifestKind, Outcome, Run, Verifier } from "./checks/types.ts";

export type { Run };

import { type Compose, type EnvValue, ParseError, parseCompose, parseEnvFile, type Service } from "./compose-parse.ts";
import { SecretMap } from "./secret-map.ts";

export type Deps = {
  /** The repository root: the lock, the cosign key and the verify-images CLI are read below it. */
  root: string;
  run: Run;
  readText?: (path: string) => string | null;
  stat?: (path: string) => Stats | null;
  uid?: number;
  checks?: readonly Check[];
  timeoutMs?: number;
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

class CannotRun extends Error {}

function parseCli(argv: string[]): { env: Env; files: string[] } {
  let values: { env?: string; compose?: string[] };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { env: { type: "string" }, compose: { type: "string", multiple: true } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new CannotRun("usage: --env dev|prod --compose <file> [--compose <file>...]");
  }
  if (values.env !== "dev" && values.env !== "prod") throw new CannotRun("--env must be dev or prod");
  if (values.compose === undefined || values.compose.length === 0) throw new CannotRun("--compose is required");
  return { env: values.env, files: values.compose.map((file) => resolve(file)) };
}

/** The compose files as one stack: one project name, and each service defined in exactly one file. */
function loadCompose(files: string[], readText: (path: string) => string | null) {
  const services: { service: Service; dir: string }[] = [];
  const secretPaths: string[] = [];
  let name: string | null = null;
  for (const file of files) {
    const text = readText(file);
    if (text === null) throw new CannotRun(`cannot read ${file}`);
    const compose = parseCompose(text, file);
    if (compose.name !== null && name !== null && compose.name !== name) throw new CannotRun("project names differ");
    name = compose.name ?? name;
    for (const service of compose.services) {
      if (services.some((s) => s.service.name === service.name)) {
        throw new CannotRun(`service ${service.name} is defined twice`);
      }
      services.push({ service, dir: dirname(file) });
    }
    secretPaths.push(...compose.secretFiles.map((path) => resolve(dirname(file), path)));
  }
  const compose: Compose = { name, services: services.map((s) => s.service), secretFiles: secretPaths };
  return { compose, services, secretPaths };
}

function readEnvFile(path: string, readText: (path: string) => string | null): [string, string][] {
  const text = readText(path);
  if (text === null) throw new CannotRun(`cannot read ${path}`);
  return parseEnvFile(text, path);
}

/** Inputs for the checks; anything that keeps the preflight from judging the stack throws CannotRun or ParseError. */
function loadInputs(argv: string[], deps: Deps): Inputs {
  const readText = deps.readText ?? readTextOrNull;
  const { env, files } = parseCli(argv);
  const { compose, services, secretPaths } = loadCompose(files, readText);
  // Compose interpolates from the `.env` beside the first file; a name it lacks becomes empty, as in Compose.
  const dotEnvPath = join(dirname(files[0] as string), ".env");
  const dotEnv = readText(dotEnvPath) === null ? [] : readEnvFile(dotEnvPath, readText);
  if (dotEnv.length > 0) secretPaths.push(dotEnvPath);
  const interpolation = new Map(dotEnv);
  const resolveValue = (value: EnvValue): string =>
    "literal" in value ? value.literal : (interpolation.get(value.ref) ?? "");
  const serviceEnv = new Map<string, SecretMap>();
  for (const { service, dir } of services) {
    const envFiles = service.envFiles.map((path) => resolve(dir, path));
    secretPaths.push(...envFiles);
    const fromFiles = envFiles.flatMap((path) => readEnvFile(path, readText));
    const fromCompose = service.environment.map(([key, value]): [string, string] => [key, resolveValue(value)]);
    serviceEnv.set(service.name, new SecretMap([...fromFiles, ...fromCompose]));
  }
  return {
    env,
    compose,
    serviceEnv,
    secretPaths: [...new Set(secretPaths)],
    lockPath: join(deps.root, "deployment/images.lock.json"),
    cosignKeyPath: join(deps.root, "deployment/cosign.pub"),
    verify: verifier(deps),
    manifestKind: manifestKind(deps),
    run: deps.run,
    retirementReportPath: join(deps.root, RETIREMENT_REPORT),
    readText,
    stat: deps.stat ?? statOrNull,
    uid: deps.uid ?? process.getuid?.() ?? -1,
  };
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
async function runCheck(check: Check, inputs: Inputs, timeoutMs: number): Promise<Outcome> {
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
  let inputs: Inputs;
  try {
    inputs = loadInputs(argv, deps);
  } catch (error) {
    if (error instanceof CannotRun || error instanceof ParseError)
      return { code: 2, lines: [`ERROR ${error.message}`] };
    return { code: 2, lines: ["ERROR the inputs could not be read"] };
  }
  const lines: string[] = [];
  let failed = false;
  for (const check of deps.checks ?? CHECKS) {
    const outcome = await runCheck(check, inputs, deps.timeoutMs ?? NETWORK_TIMEOUT_MS);
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
