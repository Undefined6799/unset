// C31 (P1.37v; ADR 0030 Decision 2): Newt's env file holds exactly its three names, as C30 holds pds.env, so no
// unreviewed setting rides in beside its credentials; every other Newt setting is a compose literal. Under dev Newt is
// the edge's only way in, so the stack must run it; local runs none, and prod has no ruling yet, so either may leave it
// out. Where Newt runs (P1.37 follow-up): outside local it runs the lock's newt image exactly, as C18 holds the edge;
// its compose settings are exactly NEWT_SETTINGS, so SSH, client access, metrics and pprof stay off; it mounts nothing
// and reads no secret; newt.env's values are not the example's replace-me, and Pangolin's endpoint is an https address
// with no credentials. A reason names a variable, never its value, and is fixed words: the runner withholds any reason
// that contains a configured value (P1.30m).

import type { EnvValue } from "../compose-parse.ts";
import type { SecretMap } from "../secret-map.ts";
import { readLock } from "./lock.ts";
import { type Check, fail, type Inputs, missing, type Outcome, pass } from "./types.ts";

/** What newt.env holds: Pangolin's address and the site's two credentials (newt 1.19.0 newtconfig/newtconfig.go). */
const NEWT_ENV = ["PANGOLIN_ENDPOINT", "NEWT_ID", "NEWT_SECRET"];
/**
 * The newt service's compose settings, each a literal of exactly this value (compose.dev.yaml; newt 1.19.0
 * newtconfig/newtconfig.go:452-503 reads each from the environment, and DISABLE_SSH and DISABLE_CLIENTS default to
 * false). Any other name is refused: a Newt feature flag set here would be unreviewed.
 */
const NEWT_SETTINGS: Readonly<Record<string, string>> = {
  CONFIG_FILE: "/tmp/newt.json",
  DISABLE_SSH: "true",
  DISABLE_CLIENTS: "true",
  NEWT_METRICS_PROMETHEUS_ENABLED: "false",
  NEWT_PPROF_ENABLED: "false",
  LOG_LEVEL: "WARN",
};
/** deployment/env/newt.example.env's value for each of the three names. */
const EXAMPLE_VALUE = "replace-me";

/** A name C31 may print: a setting it knows. Anything else in a key slot might be a pasted value, so it is not named. */
const PRINTABLE: ReadonlySet<string> = new Set([...NEWT_ENV, ...Object.keys(NEWT_SETTINGS)]);
const label = (name: string) => (PRINTABLE.has(name) ? name : "a name");

export const c31: Check = {
  id: "C31",
  run: (inputs) => {
    const { env: stage, envFileNames, compose } = inputs;
    const newt = compose.services.find((s) => s.name === "newt");
    if (newt === undefined)
      return stage === "dev" ? fail("no newt service; under dev it is the edge's only way in") : pass();
    // One file holds the set, so its names cannot be split across a second, unreviewed one.
    if (newt.envFiles.length !== 1)
      return fail(`the newt service reads ${newt.envFiles.length} env files, not exactly one`);
    // Compose's environment wins over env_file (compose-spec de28432 spec.md:1427: "values set by `environment` have
    // precedence"), so a name of the set written there would shadow newt.env's value.
    const inCompose = newt.environment.find(([name]) => NEWT_ENV.includes(name));
    if (inCompose !== undefined) return fail(`${inCompose[0]} is set in the newt service's environment, not newt.env`);
    const names = envFileNames.get("newt") ?? [];
    const repeated = names.find((name, i) => names.indexOf(name) !== i);
    if (repeated !== undefined) return fail(`${label(repeated)} is repeated in the newt env file`);
    const extra = names.find((name) => !NEWT_ENV.includes(name));
    if (extra !== undefined) return fail(`${label(extra)} is in the newt env file, which holds only its three names`);
    const absent = NEWT_ENV.find((name) => !names.includes(name));
    if (absent !== undefined) return fail(`${absent} is missing from the newt env file`);
    return (
      lockedImage(inputs, newt.image) ??
      settingsProblem(newt.environment) ??
      (newt.mounts.length > 0 ? fail("the newt service mounts a file or volume") : null) ??
      (newt.secrets.length > 0 ? fail("the newt service reads a secret") : null) ??
      valuesProblem(inputs.serviceEnv.get("newt")) ??
      pass()
    );
  },
};

/** Outside local, the newt service runs the lock's newt entry exactly, as C18 holds the edge to the lock's edge. */
function lockedImage(inputs: Inputs, image: string | null): Outcome | null {
  if (inputs.env === "local") return null;
  const lock = readLock(inputs);
  if (lock === null) return missing(inputs.lockPath);
  const ref = lock.newt?.ref;
  if (typeof ref !== "string") return missing("the lock's newt entry");
  return image === ref ? null : fail("the newt service does not run the lock's newt image");
}

/** The newt service's compose environment is NEWT_SETTINGS exactly, every value a literal. */
function settingsProblem(environment: readonly [string, EnvValue][]): Outcome | null {
  const extra = environment.find(([name]) => !Object.hasOwn(NEWT_SETTINGS, name));
  if (extra !== undefined) return fail(`${label(extra[0])} is not a newt setting the preflight allows`);
  // In Compose's list form a repeated name's last value wins, so each setting is written once.
  const repeated = environment.find(([name], i) => environment.findIndex(([key]) => key === name) !== i);
  if (repeated !== undefined) return fail(`${label(repeated[0])} is set twice in the newt service`);
  for (const [name, expected] of Object.entries(NEWT_SETTINGS)) {
    const value = environment.find(([key]) => key === name)?.[1];
    if (value === undefined) return fail(`${name} is not set in the newt service`);
    if (!("literal" in value) || value.literal !== expected) {
      return fail(`${name} is not its reviewed literal in the newt service`);
    }
  }
  return null;
}

/** newt.env's values: none is the example's or empty, and the endpoint is https with no userinfo. No value is ever printed. */
function valuesProblem(env: SecretMap | undefined): Outcome | null {
  if (env === undefined) return null;
  const example = NEWT_ENV.find((name) => env.use(name, (value) => value === EXAMPLE_VALUE));
  if (example !== undefined) return fail(`${example} is still the example file's placeholder`);
  // Newt 1.19.0 applies a string setting only when it is non-empty (newtconfig/newtconfig.go:191-196, applyEnvStr),
  // and for NEWT_ID and NEWT_SECRET then falls back to SITE_ID and SITE_SECRET (:207-217, applyEnvStrAlias), which no
  // file here may set; blank is as unusable as empty, so both are refused.
  const empty = NEWT_ENV.find((name) => env.use(name, (value) => value?.trim() === ""));
  if (empty !== undefined) return fail(`${empty} is empty`);
  const https = env.use("PANGOLIN_ENDPOINT", (value) => {
    if (value === undefined || !URL.canParse(value)) return false;
    const url = new URL(value);
    // Newt appends its API path to the endpoint, so it is a bare base address: no path, query or fragment. The URL
    // parser drops an empty `?` or `#` (search and hash read ""), so the raw value is checked for both.
    const bare = url.pathname === "/" && url.search === "" && url.hash === "" && !/[?#]/.test(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.hostname !== "" && bare;
  });
  return https ? null : fail("PANGOLIN_ENDPOINT is not a bare https address without credentials");
}
