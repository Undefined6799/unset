// P1.27y (architecture amendment to 2026-10-12-p129-compose-service-keys): C26 copies the images workflow's context
// rule, and deployment/ imports nothing from .github/, so this test reads the workflow and fails unless its build step
// still has exactly the two arms C26 assumes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const WORKFLOW = join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "images.yml");

/** The arms of the scan-image build step's `case "$DOCKERFILE" in … esac`, trimmed, in order. */
function contextArms(text: string): string[] {
  const job = text.slice(text.indexOf("\n  scan-image:"));
  const block = /case "\$DOCKERFILE" in\n([\s\S]*?)\n\s*esac/.exec(job)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("c26_context_rule_matches_the_images_workflow", () => {
  // A file named Dockerfile builds from its own folder; any other from the repository root (C26, checks/build.ts).
  expect(contextArms(readFileSync(WORKFLOW, "utf8"))).toEqual([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template.
    '*/Dockerfile) CONTEXT="${DOCKERFILE%/*}" ;;',
    '*) CONTEXT="." ;;',
  ]);
});
