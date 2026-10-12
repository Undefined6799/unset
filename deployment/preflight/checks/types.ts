// What every check sees and answers (P1.30). Inputs are read once by index.ts; a check never prints a value from a
// SecretMap, only a variable name, a path or an image reference.
import type { Stats } from "node:fs";
import type { Compose, Service } from "../compose-parse.ts";
import type { SecretMap } from "../secret-map.ts";

export type Env = "dev" | "prod";
/** A file secret bind-mounted into containers, with the `user` of each service that mounts it (null when unset). */
export type MountedSecret = { path: string; mountedBy: { service: string; user: string | null }[] };
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
  /** The repository root: the build context of every *.Dockerfile (C26), and where the Dockerfiles live. */
  root: string;
  compose: Compose;
  /** Each service's environment as the container gets it: its env files, then its `environment` entries. */
  serviceEnv: ReadonlyMap<string, SecretMap>;
  /** Absolute paths of every file Compose itself reads for values: env files and the project's `.env`. */
  secretPaths: string[];
  /** Every top-level file secret, by absolute path, with the services that mount it (P1.30o). */
  mountedSecrets: MountedSecret[];
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
  /** Like `stat`, but a symlink is reported as itself (C9 refuses a link anywhere on a mounted secret's path). */
  lstat: (path: string) => Stats | null;
  /** The path with every link resolved, null when it does not exist, throwing on any other error (C9 fails closed). */
  realpath: (path: string) => string | null;
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
/** The prefix of every missing-input reason; the runner keeps it when it withholds the rest (P1.30m). */
export const MISSING = "input missing: ";
export const missing = (path: string): Outcome => fail(`${MISSING}${path}`);

export function serviceNamed(inputs: Inputs, name: string): Service | undefined {
  return inputs.compose.services.find((service) => service.name === name);
}

/**
 * Whether a service runs one image, judged by every identity it gives (Codex ruling 3, batch 33): its image against
 * the lock's `ref`, and its build's resolved Dockerfile against `dockerfile`. A service whose two disagree is
 * "mismatch", so neither one alone can make it pass.
 */
export function runsImage(service: Service, ref: unknown, dockerfile: string): "yes" | "no" | "mismatch" {
  const views = [
    service.image === null ? null : service.image === ref,
    service.build === null ? null : service.build.dockerfile === dockerfile,
  ];
  if (views.includes(true) && views.includes(false)) return "mismatch";
  return views.includes(true) ? "yes" : "no";
}
