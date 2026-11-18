// The type check of the Svelte components (P1.20c): svelte-check 4.7.8 on TypeScript 6, because it does not run on
// the repo's TypeScript 7 (ADR 0054 Consequences), over tsconfig.svelte.json (lib/: the shadcn-svelte components, the
// Icon and their index files). tsconfig.json leaves lib/ to it. Warnings fail too: these files are few and ours to keep.
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("svelte_check_finds_nothing_in_the_components", () => {
  const run = spawnSync(
    "npx",
    ["svelte-check", "--tsconfig", "./tsconfig.svelte.json", "--threshold", "warning", "--output", "machine"],
    { cwd: import.meta.dirname, encoding: "utf8" },
  );
  const lines = (run.stdout ?? "").split("\n");
  const summary = lines.find((line) => / COMPLETED \d+ FILES/.test(line)) ?? "";
  expect(summary, run.stderr).toMatch(/ COMPLETED \d+ FILES 0 ERRORS 0 WARNINGS/);
  expect(Number(/ COMPLETED (\d+) FILES/.exec(summary)?.[1])).toBeGreaterThan(30);
}, 120_000);
