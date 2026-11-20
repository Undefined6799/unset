// P1.39a (ADR 0046): each reviewed config in adapted/ is exactly what the built edge image adapts for that env's
// files with the sentinel values. It builds the edge image, so it is an *.image.test.ts file (P1.28i), and carries no
// skip of its own (P1.28j): without Docker it fails. It makes its own Docker calls with
// node built-ins, so a trusted test owns its inputs.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  ADAPT_COMMAND,
  ADAPT_RUN_FLAGS,
  ADAPTED_ENVS,
  type AdaptedEnvName,
  type Json,
  reviewedDifference,
  SENTINELS,
} from "./adapted.ts";
import { BUILD_CALL_MS, buildTestBudget, CALL_MS, removalBudget, runOrKill } from "./docker-call.ts";
import { removeEveryTag } from "./image-cleanup.ts";

const EDGE = import.meta.dirname;
const docker = (args: readonly string[], timeoutMs: number) => runOrKill(spawnSync, "docker", args, timeoutMs);
const built: string[] = [];
const BUILDS = 2;

/** Each env's read-only file binds under /etc/caddy, as its compose file mounts them (prod: P5; ADR 0032 Decision 3). */
const bind = (file: string, target: string): string => `${join(EDGE, file)}:/etc/caddy/${target}:ro`;
const MOUNTS: Readonly<Record<AdaptedEnvName, readonly string[]>> = {
  prod: [bind("sites/pds.caddy", "sites/enabled/pds.caddy")],
  dev: [
    bind("dev/app.caddy", "sites/enabled/app.caddy"),
    bind("dev/pds.caddy", "sites/enabled/pds.caddy"),
    bind("dev/docs.caddy", "sites/enabled/docs.caddy"),
    bind("dev/media.caddy", "sites/enabled/media.caddy"),
    bind("dev/tls.caddy", "snippets/tls.caddy"),
  ],
  local: [
    bind("sites/pds.caddy", "sites/enabled/pds.caddy"),
    bind("local/app.caddy", "sites/enabled/app.caddy"),
    bind("local/tls.caddy", "snippets/tls.caddy"),
  ],
};

/** `caddy adapt` in `image` with one env's mounts and the sentinel values, under the flags the preflight's C18 runs it with. */
function adapt(image: string, env: AdaptedEnvName): Json {
  const result = docker(
    [
      "run",
      ...ADAPT_RUN_FLAGS,
      ...Object.entries(SENTINELS).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
      ...MOUNTS[env].flatMap((mount) => ["-v", mount]),
      image,
      ...ADAPT_COMMAND,
    ],
    CALL_MS,
  );
  if (result.code !== 0) throw new Error(`caddy adapt failed: ${result.err.slice(-2000)}`);
  return JSON.parse(result.out) as Json;
}

/**
 * The config files the image holds under /etc/caddy, by their repository path under deployment/edge, in three calls
 * whatever the number of snippets (P1.27h, N1): the snippet names, each file's size in bytes (busybox `stat -c %s`, one
 * line per file in the order given), and every file through one `cat`, cut at those sizes.
 */
function imageConfig(image: string): Record<string, string> {
  const listed = docker(["run", "--rm", "--entrypoint", "ls", image, "/etc/caddy/snippets"], CALL_MS);
  if (listed.code !== 0) throw new Error(`listing the image's snippets failed: ${listed.err.slice(-2000)}`);
  const files = [
    "Caddyfile",
    "sites/pds.caddy",
    ...listed.out
      .split("\n")
      .filter((f) => f !== "")
      .map((f) => `snippets/${f}`),
  ];
  const paths = files.map((file) => `/etc/caddy/${file}`);
  const stat = docker(["run", "--rm", "--entrypoint", "stat", image, "-c", "%s", ...paths], CALL_MS);
  if (stat.code !== 0) throw new Error(`sizing the image's config failed: ${stat.err.slice(-2000)}`);
  const sizes = stat.out
    .split("\n")
    .filter((line) => line !== "")
    .map(Number);
  if (sizes.length !== files.length) throw new Error(`stat gave ${sizes.length} sizes for ${files.length} files`);
  const read = docker(["run", "--rm", "--entrypoint", "cat", image, ...paths], CALL_MS);
  if (read.code !== 0) throw new Error(`reading the image's config failed: ${read.err.slice(-2000)}`);
  const bytes = Buffer.from(read.out, "utf8");
  if (bytes.length !== sizes.reduce((sum, size) => sum + size, 0)) throw new Error("cat and stat disagree on the size");
  let at = 0;
  return Object.fromEntries(
    files.map((file, index) => {
      const size = sizes[index] ?? 0;
      const content = bytes.subarray(at, at + size).toString("utf8");
      at += size;
      return [file, content];
    }),
  );
}

describe("reviewed adapted configs against caddy adapt (P1.39a)", () => {
  afterAll(() => {
    // The tag only, never -f, and every tag tried (P1.27z, P1.11r).
    removeEveryTag(built, (tag) => {
      const removed = docker(["rmi", tag], CALL_MS);
      if (removed.code !== 0) throw new Error(removed.err.trim().slice(-500));
    });
    if (built.length > BUILDS) throw new Error(`${built.length} builds, but this hook's budget covers ${BUILDS}`);
  }, removalBudget(BUILDS));

  /** Builds deployment/edge/Dockerfile with deployment/edge as the context under its own tag; the tag. */
  const buildEdgeImage = (): string => {
    const tag = `unset-test-${randomBytes(8).toString("hex")}`;
    const build = docker(["build", "--progress=plain", "-t", tag, "-f", join(EDGE, "Dockerfile"), EDGE], BUILD_CALL_MS);
    if (build.code !== 0) throw new Error(`edge image build failed: ${build.err.slice(-4_000)}`);
    built.push(tag);
    return tag;
  };

  // The image holds the repository's config byte for byte (moved here from the reader's image test, P1.39d), so what
  // it adapts in the next test is the checkout's files and no others. A test of its own: with the three adapts its
  // budget would reach run.ts's 600 s, which buildTestBudget refuses.
  // Its docker calls after the build: ls, stat and cat of the config (3).
  test("adapted_image_holds_the_repository_config", { timeout: buildTestBudget(3) }, () => {
    const repository = Object.fromEntries(
      [
        "Caddyfile",
        "sites/pds.caddy",
        ...readdirSync(join(EDGE, "snippets"))
          .sort()
          .map((f) => `snippets/${f}`),
      ].map((file) => [file, readFileSync(join(EDGE, file), "utf8")]),
    );
    expect(imageConfig(buildEdgeImage())).toStrictEqual(repository);
  });

  // Its docker calls after the build: one adapt per env (3).
  test("adapted_reviewed_configs_are_what_the_image_adapts", { timeout: buildTestBudget(ADAPTED_ENVS.length) }, () => {
    const tag = buildEdgeImage();
    for (const env of ADAPTED_ENVS) {
      const reviewed = JSON.parse(readFileSync(join(EDGE, "adapted", `${env}.generated.json`), "utf8")) as Json;
      const adapted = adapt(tag, env);
      // Key for key first, so a failure prints the difference to review and to copy into the file.
      expect(adapted, env).toStrictEqual(reviewed);
      expect(reviewedDifference(adapted, reviewed, SENTINELS), env).toBeNull();
    }
  });
});
