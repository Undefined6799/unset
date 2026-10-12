// What every check sees and answers (P1.30). Inputs are read once by index.ts; a check never prints a value from a
// SecretMap, only a variable name, a path or an image reference.
import type { Stats } from "node:fs";
import type { Compose, Service } from "../compose-parse.ts";
import type { SecretMap } from "../secret-map.ts";

export type Env = "dev" | "prod";
export type VerifyResult = { ok: true } | { ok: false; failures: string[] };
/** Runs the verify-images CLI on a lock; production calls it by fixed path and arguments, tests pass a fake. */
export type Verifier = (lockPath: string, signal: AbortSignal) => Promise<VerifyResult>;
/** The media type of a reference's top-level manifest, read from the registry. */
export type ManifestKind = (ref: string, signal: AbortSignal) => Promise<string>;
/** A process run with fixed arguments and no shell. `missing` is true when the command is not installed. */
export type Run = (
  file: string,
  args: string[],
  signal: AbortSignal,
) => Promise<{ code: number; stdout: string; stderr: string; missing?: boolean }>;

export type Inputs = {
  env: Env;
  compose: Compose;
  /** Each service's environment as the container gets it: its env files, then its `environment` entries. */
  serviceEnv: ReadonlyMap<string, SecretMap>;
  /** Absolute paths of every env file and secret file the compose files name. */
  secretPaths: string[];
  lockPath: string;
  cosignKeyPath: string;
  verify: Verifier;
  manifestKind: ManifestKind;
  /** Host commands (C24); production runs them by fixed name and arguments, tests pass a fake. */
  run: Run;
  /** The committed retirement-check report (P1.33a) that C21 reads. */
  retirementReportPath: string;
  /** `deployment/networks.<env>.json`, the reviewed table of networks and members that C17 compares Compose with. */
  networkTablePath: string;
  /** The repository's `deployment/edge`, whose Caddyfile and snippets the edge image carries (C18). */
  edgeDir: string;
  readText: (path: string) => string | null;
  stat: (path: string) => Stats | null;
  uid: number;
};

export type Outcome = { pass: boolean; reason: string };
export type Check = {
  id: string;
  network?: true;
  run: (inputs: Inputs, signal: AbortSignal) => Outcome | Promise<Outcome>;
};

export const pass = (reason = "ok"): Outcome => ({ pass: true, reason });
export const fail = (reason: string): Outcome => ({ pass: false, reason });
export const missing = (path: string): Outcome => fail(`input missing: ${path}`);

/**
 * `outcome` with every non-empty value `env` holds under `names` replaced by its name, longest value first, for a
 * check whose reason carries text that saw those values (P1.30w, architecture ruling B2b). A reason that still holds
 * one of the values afterwards is withheld whole. The values stay inside `env.use`.
 */
export function scrubbed(outcome: Outcome, env: SecretMap, names: readonly string[]): Outcome {
  const length = (name: string) => env.use(name, (v) => v?.length ?? 0);
  let reason = outcome.reason;
  for (const name of [...names].sort((a, b) => length(b) - length(a))) {
    reason = env.use(name, (v) => (v === undefined || v === "" ? reason : reason.replaceAll(v, name)));
  }
  const leaks = names.some((name) => env.use(name, (v) => v !== undefined && v !== "" && reason.includes(v)));
  return { pass: outcome.pass, reason: leaks ? "the reason is withheld: it would print a value" : reason };
}

export function serviceNamed(inputs: Inputs, name: string): Service | undefined {
  return inputs.compose.services.find((service) => service.name === name);
}
