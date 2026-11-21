// P6.03 and P6.06 (ADR 0081 decision 4; ADR 0088 decision 1): the built door image. It runs as 65532, carries the chat
// page's build where main.ts reads it, and with no environment stops at the config check (exit 78, bootOrExit), so
// every module the door loads before reading its config is in the image. It builds an image, so it lives in an
// *.image.test.ts file (P1.28r): CI runs it after the unit tests, and a local run without Docker fails.
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../../tests/support/docker.ts";
import { buildTestImage, removeTestImage } from "../../tests/support/image-build.ts";

const REPO = join(import.meta.dirname, "../..");
const DOCKERFILE = join(import.meta.dirname, "chat-auth.Dockerfile");
const BUILD_CALL_MS = killBefore(420_000);
const CALL_MS = 60_000;
const TEST_MS = 420_000 + 4 * CALL_MS;

describe("chat-auth image", () => {
  test(
    "chat_auth_image_holds_the_page_and_boots_to_config_check",
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
          // The page's build, and nothing of apps/chat's sources or of the build tools (ADR 0088 decision 1).
          const page = shell("ls -A /app/apps/chat; test -f /app/apps/chat/dist/page/index.html && echo page");
          expect(page.out.trim().split("\n"), page.err).toEqual(["dist", "page"]);
          const tools = shell("ls /app/node_modules/vite /app/node_modules/svelte-check 2>&1 | grep -c 'No such'");
          expect(tools.out.trim(), tools.err).toBe("2");

          const bare = docker(["run", "--rm", "--read-only", "--network", "none", image], { timeoutMs: CALL_MS });
          expect(bare.code, bare.err.slice(-2000)).toBe(78);
        },
        () => removeTestImage(image, { timeoutMs: CALL_MS }),
      );
    },
    TEST_MS,
  );
});
