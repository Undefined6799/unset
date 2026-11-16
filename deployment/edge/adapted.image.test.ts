// P1.39a (ADR 0046): each reviewed config in adapted/ is exactly what the built edge image adapts for that env's
// files with the sentinel values. It builds the edge image, so it is an *.image.test.ts file (P1.28i), and carries no
// skip of its own (P1.28j): without Docker it fails. Like caddyfile.image.test.ts, it makes its own Docker calls with
// node built-ins, so a trusted test owns its inputs.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { ADAPTED_ENVS, type AdaptedEnvName, type Json, reviewedDifference, SENTINELS } from "./adapted.ts";
import { BUILD_CALL_MS, buildTestBudget, CALL_MS, removalBudget, runOrKill } from "./docker-call.ts";
import { removeEveryTag } from "./image-cleanup.ts";

const EDGE = import.meta.dirname;
const docker = (args: readonly string[], timeoutMs: number) => runOrKill(spawnSync, "docker", args, timeoutMs);
const built: string[] = [];
const BUILDS = 1;

/** Each env's read-only file binds under /etc/caddy, as its compose file mounts them (prod: P5; ADR 0032 Decision 3). */
const bind = (file: string, target: string): string => `${join(EDGE, file)}:/etc/caddy/${target}:ro`;
const MOUNTS: Readonly<Record<AdaptedEnvName, readonly string[]>> = {
  prod: [bind("sites/pds.caddy", "sites/enabled/pds.caddy")],
  dev: [
    bind("dev/app.caddy", "sites/enabled/app.caddy"),
    bind("dev/pds.caddy", "sites/enabled/pds.caddy"),
    bind("dev/tls.caddy", "snippets/tls.caddy"),
  ],
  local: [
    bind("sites/pds.caddy", "sites/enabled/pds.caddy"),
    bind("local/app.caddy", "sites/enabled/app.caddy"),
    bind("local/tls.caddy", "snippets/tls.caddy"),
  ],
};

/** `caddy adapt` in `image` with one env's mounts and the sentinel values: no network, a read-only root. */
function adapt(image: string, env: AdaptedEnvName): Json {
  const result = docker(
    [
      "run",
      "--rm",
      "--read-only",
      "--network",
      "none",
      "--entrypoint",
      "caddy",
      ...Object.entries(SENTINELS).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
      ...MOUNTS[env].flatMap((mount) => ["-v", mount]),
      image,
      "adapt",
      "--config",
      "/etc/caddy/Caddyfile",
      "--adapter",
      "caddyfile",
    ],
    CALL_MS,
  );
  if (result.code !== 0) throw new Error(`caddy adapt failed: ${result.err.slice(-2000)}`);
  return JSON.parse(result.out) as Json;
}

describe("reviewed adapted configs against caddy adapt (P1.39a)", () => {
  afterAll(() => {
    // The tag only, never -f, and every tag tried (P1.27z, P1.11r), as caddyfile.image.test.ts removes its own.
    removeEveryTag(built, (tag) => {
      const removed = docker(["rmi", tag], CALL_MS);
      if (removed.code !== 0) throw new Error(removed.err.trim().slice(-500));
    });
    if (built.length > BUILDS) throw new Error(`${built.length} builds, but this hook's budget covers ${BUILDS}`);
  }, removalBudget(BUILDS));

  // Its docker calls after the build: one adapt per env (3).
  test("adapted_reviewed_configs_are_what_the_image_adapts", { timeout: buildTestBudget(ADAPTED_ENVS.length) }, () => {
    const tag = `unset-test-${randomBytes(8).toString("hex")}`;
    const build = docker(["build", "--progress=plain", "-t", tag, "-f", join(EDGE, "Dockerfile"), EDGE], BUILD_CALL_MS);
    if (build.code !== 0) throw new Error(`edge image build failed: ${build.err.slice(-4_000)}`);
    built.push(tag);
    for (const env of ADAPTED_ENVS) {
      const reviewed = JSON.parse(readFileSync(join(EDGE, "adapted", `${env}.generated.json`), "utf8")) as Json;
      const adapted = adapt(tag, env);
      // Key for key first, so a failure prints the difference to review and to copy into the file.
      expect(adapted, env).toStrictEqual(reviewed);
      expect(reviewedDifference(adapted, reviewed, SENTINELS), env).toBeNull();
    }
  });
});
