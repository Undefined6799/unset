// The type check of the chat page's Svelte and browser code (ADR 0088): svelte-check 4.7.8 on TypeScript 6, as
// apps/web/svelte-check.test.ts runs it, over tsconfig.svelte.json (the shell, its stock components, core/ and
// matrix/). Warnings fail too.
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("svelte_check_finds_nothing_in_the_chat_page", () => {
  const run = spawnSync(
    "npx",
    ["svelte-check", "--tsconfig", "./tsconfig.svelte.json", "--threshold", "warning", "--output", "machine"],
    { cwd: import.meta.dirname, encoding: "utf8" },
  );
  const summary = (run.stdout ?? "").split("\n").find((line) => / COMPLETED \d+ FILES/.test(line)) ?? "";
  expect(summary, run.stderr).toMatch(/ COMPLETED \d+ FILES 0 ERRORS 0 WARNINGS/);
  expect(Number(/ COMPLETED (\d+) FILES/.exec(summary)?.[1])).toBeGreaterThan(10);
}, 120_000);
