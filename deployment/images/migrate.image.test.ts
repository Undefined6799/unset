// P1.29k: the built migrate image with no environment stops at the config check (exit 78, bootOrExit), so every module
// the CLI loads before reading its config is in the image. It builds an image, so it lives in an *.image.test.ts file
// (P1.28r): CI runs it after the unit tests, and a local run without Docker fails rather than skips.
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore } from "../../tests/support/docker.ts";

const DEPLOYMENT = join(import.meta.dirname, "..");
const MIGRATE_DOCKERFILE = join(DEPLOYMENT, "images/migrate.Dockerfile");
// The build gets the image tests' 600 s; each docker call is killed just under it, so a hung daemon fails the test
// with a named message instead of holding the job (P1.27k).
const BUILD_MS = 600_000;
const CALL_MS = killBefore(BUILD_MS);

describe("migrate image", () => {
  test(
    "migrate_image_boots_to_config_check",
    () => {
      const built = docker(["build", "-q", "-f", MIGRATE_DOCKERFILE, join(DEPLOYMENT, "..")], { timeoutMs: CALL_MS });
      expect(built.code, built.err.slice(-2000)).toBe(0);
      const image = built.out.trim();
      try {
        const run = docker(["run", "--rm", "--read-only", "--network", "none", image], { timeoutMs: CALL_MS });
        expect(run.code, run.err.slice(-2000)).toBe(78);
      } finally {
        docker(["rmi", "-f", image], { timeoutMs: CALL_MS });
      }
    },
    BUILD_MS,
  );
});
