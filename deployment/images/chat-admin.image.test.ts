// P6.04 (ADR 0093 decision 5; ADR 0098): the built chat-admin image. It runs as 65532, ships no node_modules entry but
// the one workspace link the service imports, owns a private state directory, and with no settings stops at the first
// one, naming it and exiting 1 (interfaces/chat-admin/main.ts), so it fails closed. package-manager.image.test.ts
// checks every kind for package managers and setuid files. It builds an image, so it lives in an *.image.test.ts file
// (P1.28r): CI runs it after the unit tests, and a local run without Docker fails rather than skips.
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";

const REPO = join(import.meta.dirname, "../..");
const DOCKERFILE = join(import.meta.dirname, "chat-admin.Dockerfile");
const BUILD_CALL_MS = killBefore(300_000);
const CALL_MS = 60_000;
const TEST_MS = 300_000 + 4 * CALL_MS;

describe("chat-admin image", () => {
  test(
    "chat_admin_image_runs_unprivileged_with_only_its_envelope_and_fails_closed",
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
          // STATE_DIR: a fresh named volume takes this directory's owner and mode, so only the service writes there.
          const state = shell("stat -c '%u:%g %a' /app/state /app");
          expect(state.out.trim().split("\n"), state.err).toEqual(["65532:65532 700", "0:0 755"]);

          const bare = docker(["run", "--rm", "--read-only", "--network", "none", image], { timeoutMs: CALL_MS });
          expect(bare.code, bare.err.slice(-2000)).toBe(1);
          expect(bare.err.trim()).toBe("chat-admin: CHAT_ADMIN_ENV is not set");
        },
        () => removeTestImage(image, { timeoutMs: CALL_MS }),
      );
    },
    TEST_MS,
  );
});
