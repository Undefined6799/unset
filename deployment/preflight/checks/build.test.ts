// P1.27y (architecture amendment to 2026-10-12-p129-compose-service-keys): C26 copies the images workflow's context
// rule, and deployment/ imports nothing from .github/, so this test reads the workflow and fails unless its build step
// still has exactly the two arms C26 assumes, and builds from the context they set.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const WORKFLOW = join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "images.yml");

/** The scan-image job's "Build" step's run script. */
function buildScript(text: string): string {
  const job = text.slice(text.indexOf("\n  scan-image:"));
  const step = job.slice(job.indexOf("- name: Build"));
  return step.slice(0, step.indexOf("\n      - name:", 1));
}

/** The arms of the build step's `case "$DOCKERFILE" in … esac`, trimmed, in order. */
function contextArms(job: string): string[] {
  const block = /case "\$DOCKERFILE" in\n([\s\S]*?)\n\s*esac/.exec(job)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("c26_context_rule_matches_the_images_workflow", () => {
  // A file named Dockerfile builds from its own folder; any other from the repository root (C26, checks/build.ts).
  const script = buildScript(readFileSync(WORKFLOW, "utf8"));
  expect(contextArms(script)).toEqual([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template.
    '*/Dockerfile) CONTEXT="${DOCKERFILE%/*}" ;;',
    '*) CONTEXT="." ;;',
  ]);
  // P1.27n (verifier N1 on #675): the arms set CONTEXT and nothing else does, and the build is given that context.
  // The pattern leaves out the word docker so image-rules.test.ts does not read this text check as an image build.
  // P1.27w (verifier N-a on #687): CONTEXT appears exactly three times, the two arms and the build line, so no other
  // assignment form (`CONTEXT+=`, `printf -v CONTEXT`, `read -r CONTEXT`) slips in. A `cd` before the build line
  // would still pass: a known limit of reading the step as text.
  expect(script.match(/\bCONTEXT\b/g)).toHaveLength(3);
  expect(script).toMatch(/\bbuildx build [^\n]*\\\n\s*[^\n]*-f "\$DOCKERFILE" "\$CONTEXT"$/);
});
