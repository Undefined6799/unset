// ADR 0070: the built review image with no environment stops at the config check (exit 78, bootOrExit), so every module
// the process loads before reading its config is in the image (as migrate.image.test.ts). It builds an image, so it
// lives in an *.image.test.ts file (P1.28r): CI runs it after the unit tests, and a local run without Docker fails.
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";

const DEPLOYMENT = join(import.meta.dirname, "..");
const REVIEW_DOCKERFILE = join(DEPLOYMENT, "images/review.Dockerfile");
// Each docker call is killed at its own budget, so a hung daemon fails the test with a named message before
// scripts/test/run.ts kills the whole run at 600 s (P1.27k, P1.27g): the build at 295 s, the two runs and the removal
// at 60 s each. The test's budget holds all four.
const BUILD_CALL_MS = killBefore(300_000);
const CALL_MS = 60_000;
const TEST_MS = 300_000 + 3 * CALL_MS;

describe("review image", () => {
  test(
    "review_image_boots_to_config_check",
    () => {
      const image = buildTestImage(REVIEW_DOCKERFILE, join(DEPLOYMENT, ".."), { timeoutMs: BUILD_CALL_MS });
      withCleanup(
        () => {
          const run = docker(["run", "--rm", "--read-only", "--network", "none", image], { timeoutMs: CALL_MS });
          expect(run.code, run.err.slice(-2000)).toBe(78);
          // Each child's address-space limit comes from util-linux's prlimit (infrastructure/image/pool.ts).
          const prlimit = docker(
            ["run", "--rm", "--network", "none", "--entrypoint", "/usr/bin/prlimit", image, "--version"],
            {
              timeoutMs: CALL_MS,
            },
          );
          expect(prlimit.code, prlimit.err.slice(-2000)).toBe(0);
        },
        () => removeTestImage(image, { timeoutMs: CALL_MS }),
      );
    },
    TEST_MS,
  );
});
