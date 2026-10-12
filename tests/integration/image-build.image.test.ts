// tests/support/image-build.ts (P1.27x): two builds of one Dockerfile and context share an image id, so removing one
// build must never remove the other, and a failed build names the failing step's own output. The shared build starts
// FROM scratch; the failing one runs a shell in the pinned node base (deployment/images/bases.lock.json), which the
// edge probe pulls in the same run.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../support/docker.ts";
import { buildTestImage, removeTestImage } from "../support/image-build.ts";

const TEST_MS = 120_000;
// A pull of the node base when it is not cached yet, as edge-container.ts allows it.
const FAILING_TEST_MS = 300_000;
// Two builds, two removals and an inspect fit inside the test.
const CALL_MS = killBefore(TEST_MS) / 5;

const lock = JSON.parse(readFileSync(join(import.meta.dirname, "../../deployment/images/bases.lock.json"), "utf8"));
const NODE = `${lock.node.ref}:${lock.node.tag}@${lock.node.digest}`;
const dir = mkdtempSync(join(tmpdir(), "image-build-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Writes `dockerfile` beside the marker files in the shared context folder; its path. */
function context(name: string, dockerfile: string): string {
  writeFileSync(join(dir, `${name}.marker`), name);
  const file = join(dir, `${name}.Dockerfile`);
  writeFileSync(file, dockerfile);
  return file;
}

describe("buildTestImage", () => {
  test("removing_one_build_keeps_the_other", { timeout: TEST_MS }, () => {
    const file = context("shared", "FROM scratch\nCOPY shared.marker /marker\n");
    // Every tag still standing is removed, even when the second build throws.
    const tags: string[] = [];
    withCleanup(
      () => {
        tags.push(buildTestImage(file, dir, { timeoutMs: CALL_MS }));
        tags.push(buildTestImage(file, dir, { timeoutMs: CALL_MS }));
        removeTestImage(tags.shift() ?? "", { timeoutMs: CALL_MS });
        expect(docker(["image", "inspect", tags[0] ?? ""], { timeoutMs: CALL_MS }).code).toBe(0);
      },
      () => {
        for (const tag of tags) removeTestImage(tag, { timeoutMs: CALL_MS });
      },
    );
  });

  // P1.11i: a leaked tag can be found by the label the test containers carry, without guessing at names.
  test("built_image_carries_the_owner_label", { timeout: TEST_MS }, () => {
    const file = context("labelled", "FROM scratch\nCOPY labelled.marker /marker\n");
    const tag = buildTestImage(file, dir, { timeoutMs: CALL_MS });
    withCleanup(
      () => {
        const format = '{{index .Config.Labels "sh.unset.test-owner"}}';
        const inspected = docker(["image", "inspect", "--format", format, tag], { timeoutMs: CALL_MS });
        expect(inspected.out.trim()).toBe(String(process.pid));
      },
      () => removeTestImage(tag, { timeoutMs: CALL_MS }),
    );
  });

  test("failed_build_names_the_step_output", { timeout: FAILING_TEST_MS }, () => {
    // The step computes its message, so the Dockerfile excerpt and the error line, which quote the command, never hold
    // it: only the step's own output can.
    const file = context("failing", `FROM ${NODE}\nRUN echo "go: cause $((6 * 7))" >&2; exit 3\n`);
    expect(() => buildTestImage(file, dir, { timeoutMs: killBefore(FAILING_TEST_MS) })).toThrow(/go: cause 42/);
  });
});
