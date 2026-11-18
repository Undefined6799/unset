// The type check of the screens (.svelte files): svelte-check 4.7.8 on TypeScript 6, because it does not run on the
// repo's TypeScript 7 (ADR 0054 Consequences). The .ts files of this folder are also checked by `tsc -b` on
// TypeScript 7 (tsconfig.json). svelte-check also reports the files those screens reach, under this folder's
// settings (tsconfig.svelte.json: the DOM library, exactOptionalPropertyTypes off, ADR 0056 item 8), where two files
// outside fail on TypeScript 6 only; they pass `tsc -b`, so this test fails on an error in this folder only.
import { execFileSync, spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const HERE = import.meta.dirname;

test("svelte_check_finds_no_error_in_the_web_folder", () => {
  execFileSync("npx", ["svelte-kit", "sync"], { cwd: HERE, stdio: "ignore" });
  const run = spawnSync(
    "npx",
    ["svelte-check", "--tsconfig", "./tsconfig.svelte.json", "--threshold", "error", "--output", "machine"],
    { cwd: HERE, encoding: "utf8" },
  );
  const lines = (run.stdout ?? "").split("\n");
  expect(
    lines.some((line) => / COMPLETED \d+ FILES/.test(line)),
    run.stderr,
  ).toBe(true);
  const ours = lines.filter((line) => / ERROR "/.test(line) && !/ ERROR "\.\.\//.test(line));
  expect(ours).toEqual([]);
}, 120_000);
