// The stale branch of `node scripts/ui/font-metrics.ts --check` (P1.24c rider, book phase-1.md:6426). The script finds
// its inputs beside itself (../../shared/ui), so the run uses a copy of the script, the sheet, the fonts and a
// committed file that no longer matches; the repository's own file is never touched.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { OUTPUT } from "./font-metrics.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const COPY = mkdtempSync(join(tmpdir(), "font-metrics-"));
afterAll(() => rmSync(COPY, { recursive: true, force: true }));

function copyTree(): string {
  mkdirSync(join(COPY, "scripts", "ui"), { recursive: true });
  cpSync(join(ROOT, "scripts", "ui", "font-metrics.ts"), join(COPY, "scripts", "ui", "font-metrics.ts"));
  for (const part of ["sheet", "fonts", "tokens"])
    cpSync(join(ROOT, "shared", "ui", part), join(COPY, "shared", "ui", part), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(COPY, "node_modules"), "dir");
  return join(COPY, "shared", "ui", OUTPUT);
}

const check = () =>
  spawnSync(process.execPath, [join("scripts", "ui", "font-metrics.ts"), "--check"], { cwd: COPY, encoding: "utf8" });

test("font_metrics_check_fails_when_stale", () => {
  const output = copyTree();
  expect(check().status, "the copy starts current").toBe(0);
  const committed = readFileSync(output, "utf8");
  const stale = JSON.parse(committed);
  stale.$comment = `${stale.$comment} (stale)`;
  const staleText = `${JSON.stringify(stale, null, 2)}\n`;
  writeFileSync(output, staleText);
  const run = check();
  expect(run.status).toBe(1);
  expect(run.stderr).toContain(`font-metrics: ${OUTPUT} is stale`);
  // --check writes nothing. Byte for byte, so a check that emptied the file fails.
  expect(readFileSync(output, "utf8")).toBe(staleText);
});
