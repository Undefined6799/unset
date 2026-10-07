// The shared/ui build entries run under plain Node (P1.24b). Node 26.10.0 strips types from .ts files but refuses .tsx
// with ERR_UNKNOWN_FILE_EXTENSION, so every module shared/ui/index.ts reaches must be .ts. Vitest transforms .tsx
// itself, so only a real `node` run catches a .tsx export (P1.24j exported slot.tsx and broke these entries).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

test("ui_build_entries_run_in_node", () => {
  for (const entry of ["icons.ts", "tokens.ts", "font-metrics.ts"]) {
    const run = spawnSync(process.execPath, [join("scripts", "ui", entry), "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(run.stderr, entry).not.toMatch(/ERR_UNKNOWN_FILE_EXTENSION/);
    expect(run.status, `${entry}: ${run.stderr}`).toBe(0);
  }
});
