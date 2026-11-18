// P2.09d: the built pds-admin image (ADR 0060). It runs as 65532, ships no node_modules entry but the one workspace
// link the service imports, and with its settings but no secrets it loads every module and stops at the first secret,
// naming it and exiting 1 (interfaces/pds-admin/main.ts), so it fails closed. package-manager.image.test.ts already
// checks every kind for package managers and setuid files. It builds an image, so it lives in an *.image.test.ts file
// (P1.28r): CI runs it after the unit tests, and a local run without Docker fails rather than skips.
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";

const REPO = join(import.meta.dirname, "../..");
const DOCKERFILE = join(import.meta.dirname, "pds-admin.Dockerfile");
// Each docker call is killed at its own budget, as in migrate.image.test.ts: the build at 295 s, four runs and the
// removal at 60 s each. The test's budget holds all of them.
const BUILD_CALL_MS = killBefore(300_000);
const CALL_MS = 60_000;
const TEST_MS = 300_000 + 5 * CALL_MS;
/** The settings readConfig checks before it reads a secret; values are placeholders, nothing is contacted. */
const SETTINGS = [
  "PDS_ADMIN_ENV=prod",
  "PDS_DID=did:web:pds.test",
  "PDS_INTERNAL_URL=http://pds:3000",
  "SIGNUPS_OPEN=false",
];

describe("pds-admin image", () => {
  test(
    "pds_admin_image_runs_unprivileged_with_only_its_envelope_and_fails_closed",
    () => {
      const image = buildTestImage(DOCKERFILE, REPO, { timeoutMs: BUILD_CALL_MS });
      withCleanup(
        () => {
          const shell = (script: string) =>
            docker(["run", "--rm", "--read-only", "--network", "none", "--entrypoint", "sh", image, "-c", script], {
              timeoutMs: CALL_MS,
            });
          const user = shell("id -u; id -g");
          expect(user.out.trim().split("\n"), user.err).toEqual(["65532", "65532"]);
          const modules = shell("ls -A /app/node_modules; ls -A /app/node_modules/@unset");
          expect(modules.out.trim().split("\n"), modules.err).toEqual(["@unset", "shared-admin-envelope"]);

          const bare = docker(["run", "--rm", "--read-only", "--network", "none", image], { timeoutMs: CALL_MS });
          expect(bare.code, bare.err.slice(-2000)).toBe(1);
          expect(bare.err.trim()).toBe("pds-admin: PDS_ADMIN_ENV is not set");

          const env = SETTINGS.flatMap((setting) => ["--env", setting]);
          const noSecrets = docker(["run", "--rm", "--read-only", "--network", "none", ...env, image], {
            timeoutMs: CALL_MS,
          });
          expect(noSecrets.code, noSecrets.err.slice(-2000)).toBe(1);
          expect(noSecrets.err.trim()).toBe("pds-admin: secret pds_admin_log_key cannot be read");
        },
        () => removeTestImage(image, { timeoutMs: CALL_MS }),
      );
    },
    TEST_MS,
  );
});
