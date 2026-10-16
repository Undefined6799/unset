// P2.04c: the built web image with no environment stops at the config check (exit 78, bootOrExit), so every module the
// server loads before reading its config is in the image: since P2.04c that includes the identity domain and the
// infrastructure packages the OAuth client stands on, which the runtime stage copies one by one. Mirrors
// migrate_image_boots_to_config_check; it builds an image, so it lives in an *.image.test.ts file (P1.28r).
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";

const DEPLOYMENT = join(import.meta.dirname, "..");
const WEB_DOCKERFILE = join(DEPLOYMENT, "images/node-app.Dockerfile");
// As the migrate test: the build at 295 s, the run and the removal at 60 s each, all inside the test's budget.
const BUILD_CALL_MS = killBefore(300_000);
const CALL_MS = 60_000;
const TEST_MS = 300_000 + 2 * CALL_MS;

describe("web image", () => {
  test(
    "web_image_boots_to_config_check",
    () => {
      const image = buildTestImage(WEB_DOCKERFILE, join(DEPLOYMENT, ".."), { timeoutMs: BUILD_CALL_MS });
      withCleanup(
        () => {
          const run = docker(["run", "--rm", "--read-only", "--network", "none", image], { timeoutMs: CALL_MS });
          expect(run.code, run.err.slice(-2000)).toBe(78);
        },
        () => removeTestImage(image, { timeoutMs: CALL_MS }),
      );
    },
    TEST_MS,
  );
});
