// C18's second half (P1.39c; ADR 0046 decision 4): what Caddy itself makes of the edge's files. The edge image runs
// `caddy adapt` on the config the edge service mounts, with the service's values, and the JSON it prints must be the
// reviewed adapted config (deployment/edge/adapted.ts) and break none of the rules on it
// (deployment/edge/adapted-rules.ts). Both are imported here and nowhere duplicated.
//
// The container is given nothing to act with (ADAPT_RUN_FLAGS in deployment/edge/adapted.ts, the same for a pulled and
// a built image, and the flags adapted.image.test.ts runs the real image with): no network, a read-only root, no
// capability but the one the binary's file capability needs to start, no new privileges, the edge's own uid, and
// only the edge service's read-only binds under /etc/caddy, which C18's first half has judged.
// The values go to the docker client's environment and are named, never written, in its arguments (`-e NAME`). Every
// failure is fixed words: nothing Docker or Caddy printed is repeated, since Caddy's errors quote the config.
//
// Docker's flags as read in docker/cli v28.5.1 docs/reference/commandline/container_run.md: `--pull never` ("Do not
// pull the image, even if it's missing, and produce an error"), `-e VAR` with no value ("variables exported to your
// local environment"), `--read-only`, `--security-opt no-new-privileges`; and `docker build -q` in
// docs.docker.com/reference/cli/docker/buildx/build ("Suppress the build output and print image ID on success"),
// both read 2026-11-16. The same `-v source:target:ro` binds, `--read-only` and `--network none` are what
// deployment/edge/adapted.image.test.ts runs against the built image in CI.
import { join } from "node:path";
import { ADAPT_COMMAND, ADAPT_RUN_FLAGS, type Json, reviewedDifference } from "../../edge/adapted.ts";
import {
  type AdaptedEnv,
  adaptedProblems,
  type EdgeMode,
  ENV_NAMES,
  type EnvName,
  envProblems,
} from "../../edge/adapted-rules.ts";
import type { SecretMap } from "../secret-map.ts";
import { fail, type Inputs, missing, type Outcome, pass } from "./types.ts";

/** The image `caddy adapt` runs in: the lock's edge reference, or the edge's own build from the checkout. */
export type EdgeImage = { ref: string } | { dockerfile: string; context: string };
/** One of the edge service's read-only binds under /etc/caddy, as C18's compose rules passed it. */
export type CaddyBind = { source: string; target: string };

/** C18's own deadline: a first pull or build of the edge image takes minutes. Set here and nowhere else. */
export const ADAPT_TIMEOUT_MS = 600_000;

/** An image reference by digest whose first character cannot start an option. */
const BY_DIGEST = /^[a-z0-9][a-z0-9./-]*(?::[\w.-]+)?@sha256:[0-9a-f]{64}$/;
/** What `docker build -q` prints: the image's id. */
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;

/**
 * The reviewed config each mode is held to, by its file in deployment/edge/adapted/; under dev, the source stack's
 * edge, which names the chat site's host, is held to dev-chat (P6.02).
 */
const REVIEWED: Record<EdgeMode, string> = { shipped: "prod", dev: "dev", local: "local" };
const reviewedFor = (mode: EdgeMode, values: AdaptedEnv): string =>
  mode === "dev" && values.CHAT_HOST !== undefined ? "dev-chat" : REVIEWED[mode];

const NO_DOCKER = "docker is not installed, so the edge config could not be adapted";

/**
 * The image to run, by digest or id, or why there is none. The lock's reference is pulled, so the run itself can
 * refuse to pull; a built edge is built here from the Dockerfile and context C26's rule passed.
 */
async function imageToRun(inputs: Inputs, image: EdgeImage, signal: AbortSignal): Promise<string | Outcome> {
  if ("ref" in image) {
    if (!BY_DIGEST.test(image.ref)) return fail("the lock's edge image is not named by digest");
    const pulled = await inputs.run("docker", ["pull", image.ref], signal);
    if (pulled.missing) return fail(NO_DOCKER);
    return pulled.code === 0 ? image.ref : fail("the edge image could not be pulled");
  }
  if (!image.dockerfile.startsWith("/") || !image.context.startsWith("/")) {
    return fail("the edge image could not be built");
  }
  const built = await inputs.run("docker", ["build", "-q", "-f", image.dockerfile, image.context], signal);
  if (built.missing) return fail(NO_DOCKER);
  const id = built.stdout.trim();
  return built.code === 0 && IMAGE_ID.test(id) ? id : fail("the edge image could not be built");
}

/** The binds as `-v` arguments, or null when one cannot be written as one: a relative path, or a colon in a path. */
function bindArgs(binds: readonly CaddyBind[]): string[] | null {
  const args: string[] = [];
  for (const { source, target } of binds) {
    if (!source.startsWith("/") || !target.startsWith("/") || `${source}${target}`.includes(":")) return null;
    args.push("-v", `${source}:${target}:ro`);
  }
  return args;
}

/** The edge's values by name: what `-e NAME` hands the container, and what the comparison puts for the sentinels. */
function valuesOf(env: SecretMap): AdaptedEnv {
  const values: Partial<Record<EnvName, string>> = {};
  for (const name of Object.keys(ENV_NAMES) as EnvName[]) {
    const value = env.use(name, (v) => v);
    if (value !== undefined) values[name] = value;
  }
  return values;
}

const parsed = (text: string): { json: Json } | null => {
  try {
    return { json: JSON.parse(text) as Json };
  } catch {
    return null;
  }
};

/**
 * Whether the config the edge image adapts from the edge's mounts and values is the reviewed one and passes the rules
 * on it. Called only after C18's compose rules passed, so `binds` are the judged ones.
 */
export async function adaptedEdge(
  inputs: Inputs,
  image: EdgeImage,
  binds: readonly CaddyBind[],
  env: SecretMap,
  mode: EdgeMode,
  signal: AbortSignal,
): Promise<Outcome> {
  const mounts = bindArgs(binds);
  if (mounts === null) return fail("an edge mount cannot be given to caddy adapt");
  // The values are judged before any container sees them: a missing or misshapen one, an app value equal to the
  // PDS's, or a dev app value other than the ruled one fails here, in placeholder names (P1.39e).
  const values = valuesOf(env);
  const misfit = envProblems(mode, values);
  if (misfit.length > 0) return fail(misfit.join("; "));
  const file = reviewedFor(mode, values);
  const reviewedText = inputs.readText(join(inputs.edgeDir, "adapted", `${file}.generated.json`));
  if (reviewedText === null) return missing(`deployment/edge/adapted/${file}.generated.json`);
  const reviewed = parsed(reviewedText);
  if (reviewed === null) return fail("the reviewed adapted config is not JSON");
  const runnable = await imageToRun(inputs, image, signal);
  if (typeof runnable !== "string") return runnable;
  const names = Object.keys(values).flatMap((name) => ["-e", name]);
  const ran = await inputs.run(
    "docker",
    ["run", ...ADAPT_RUN_FLAGS, ...mounts, ...names, runnable, ...ADAPT_COMMAND],
    signal,
    values,
  );
  if (ran.missing) return fail(NO_DOCKER);
  if (ran.code !== 0) return fail("caddy adapt failed in the edge image");
  const adapted = parsed(ran.stdout);
  if (adapted === null) return fail("caddy adapt printed no JSON config");
  const difference = reviewedDifference(adapted.json, reviewed.json, values);
  if (difference !== null) return fail(difference);
  const problems = adaptedProblems(adapted.json, mode, values);
  return problems.length === 0 ? pass() : fail(problems.join("; "));
}
