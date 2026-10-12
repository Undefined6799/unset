// P1.29k: the built migrate image with no environment stops at the config check (exit 78, bootOrExit), so every module
// the CLI loads before reading its config is in the image. It builds an image, so it lives in an *.image.test.ts file
// (P1.28r): CI runs it after the unit tests, and a local run without Docker fails rather than skips.
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";

const DEPLOYMENT = join(import.meta.dirname, "..");
const MIGRATE_DOCKERFILE = join(DEPLOYMENT, "images/migrate.Dockerfile");
// Each docker call is killed at its own budget, so a hung daemon fails the test with a named message before
// scripts/test/run.ts kills the whole run at 600 s (P1.27k, P1.27g): the build at 295 s, the run and the removal at
// 60 s each. The test's budget holds all three.
const BUILD_CALL_MS = killBefore(300_000);
const CALL_MS = 60_000;
const TEST_MS = 300_000 + 2 * CALL_MS;

describe("migrate image", () => {
  test(
    "migrate_image_boots_to_config_check",
    () => {
      const built = docker(["build", "-q", "-f", MIGRATE_DOCKERFILE, join(DEPLOYMENT, "..")], {
        timeoutMs: BUILD_CALL_MS,
      });
      expect(built.code, built.err.slice(-2000)).toBe(0);
      const image = built.out.trim();
      withCleanup(
        () => {
          const run = docker(["run", "--rm", "--read-only", "--network", "none", image], { timeoutMs: CALL_MS });
          expect(run.code, run.err.slice(-2000)).toBe(78);
        },
        () => docker(["rmi", "-f", image], { timeoutMs: CALL_MS }),
      );
    },
    TEST_MS,
  );
});
