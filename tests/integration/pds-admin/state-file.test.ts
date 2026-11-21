import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { tempDir } from "./harness.ts";

const STATE_FILE = pathToFileURL(join(import.meta.dirname, "../../../shared/admin-envelope/state-file.ts")).href;
const CLI = join(import.meta.dirname, "../../../interfaces/pds-admin/cli.ts");

test("state.short_write: under a 1 KiB file-size limit, a line that does not fit throws instead of passing as durable", () => {
  const file = join(tempDir(), "jti.log");
  // bash's `ulimit -f 1` is 1 KiB; the second line fits only in part, so writeSync returns a short count.
  const script = `const { appendLine } = await import(${JSON.stringify(STATE_FILE)});
appendLine(process.argv[1], "x".repeat(1000));
try { appendLine(process.argv[1], "y".repeat(100)); console.log("accepted"); } catch { console.log("refused"); }`;
  const result = spawnSync(
    "bash",
    ["-c", 'ulimit -f 1; exec "$0" --input-type=module -e "$1" "$2"', process.execPath, script, file],
    {
      encoding: "utf8",
    },
  );
  expect(result.stdout.trim()).toBe("refused");
  // The torn part of the second line is cut away, so the next append starts on a line boundary.
  expect(readFileSync(file, "utf8")).toBe(`${"x".repeat(1000)}\n`);
});

test("cli.verify_log_missing: a log path that does not exist exits 1, never ok", () => {
  const result = spawnSync(process.execPath, [CLI, "verify-log", join(tempDir(), "missing.jsonl")], {
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain("ok");
});
