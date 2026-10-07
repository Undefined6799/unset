// P1.29k: the built migrate image with no environment stops at the config check (exit 78, bootOrExit), so every module
// the CLI loads before reading its config is in the image. It builds an image, so it lives in an *.image.test.ts file
// (P1.28r): CI runs it after the unit tests, and a local run without Docker fails rather than skips.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const DEPLOYMENT = join(import.meta.dirname, "..");
const MIGRATE_DOCKERFILE = join(DEPLOYMENT, "images/migrate.Dockerfile");

describe("migrate image", () => {
  test("migrate_image_boots_to_config_check", () => {
    const built = spawnSync("docker", ["build", "-q", "-f", MIGRATE_DOCKERFILE, join(DEPLOYMENT, "..")], {
      encoding: "utf8",
    });
    expect(built.status, built.stderr.slice(-2000)).toBe(0);
    const image = built.stdout.trim();
    try {
      const run = spawnSync("docker", ["run", "--rm", "--read-only", "--network", "none", image], { encoding: "utf8" });
      expect(run.status, run.stderr.slice(-2000)).toBe(78);
    } finally {
      spawnSync("docker", ["rmi", "-f", image], { stdio: "ignore" });
    }
  }, 600_000);
});
