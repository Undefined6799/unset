// P0.07q: the WebKit leg ran 22 to 29 minutes against its 30 (runs of 2026-11-23/24), so one failing test and the
// worker restarts after it ran the job into its limit with no error printed. Each browser now runs as shards
// (playwright.dev/docs/test-sharding, Playwright 1.64.1), each on its own runner with its own servers, Postgres and
// rate-limit buckets, and the gate merges each browser's blob reports into one JSON report (merge-reports) before
// assert-tests-ran reads them, so a missing shard still fails.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { E2E_PROJECTS } from "../test/assert-tests-ran.ts";

type Step = { run?: string; uses?: string; with?: Record<string, string>; env?: Record<string, string> };
type Job = {
  env?: Record<string, string>;
  strategy?: { matrix?: { shard?: number[] } };
  steps?: Step[];
  "timeout-minutes"?: number;
};
const ROOT = join(import.meta.dirname, "..", "..");
const wf = parse(readFileSync(join(ROOT, ".github", "workflows", "e2e.yml"), "utf8")) as {
  env?: Record<string, string>;
  jobs: Record<string, Job>;
};

describe("browser shards (P0.07q)", () => {
  const shards = Number(wf.env?.E2E_SHARDS);
  const browser = wf.jobs.browser;
  const merge = wf.jobs.e2e?.steps?.find((step) => step.run?.includes("merge-reports"));

  test("every_browser_runs_every_shard_once", () => {
    expect(shards).toBeGreaterThan(1);
    expect(browser?.strategy?.matrix?.shard).toEqual(Array.from({ length: shards }, (_, i) => i + 1));
    expect(browser?.env?.SHARD).toBe(`$${"{{"} matrix.shard }}`);
    const tests = browser?.steps?.find((step) => step.run?.includes("npx playwright test"));
    expect(tests?.run).toContain('--project "$PROJECT" --shard "$SHARD/$E2E_SHARDS"');
  });

  // On CI the config writes a blob report (process.env.CI, as the sharding guide does) and ends the run before the
  // job's limit, so a stalled or failing run still prints its errors and uploads its reports.
  test("each_shard_keeps_its_blob_report_and_ends_before_the_job_limit", () => {
    const upload = browser?.steps?.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with?.name).toBe(`e2e-$${"{{"} matrix.project }}-$${"{{"} matrix.shard }}`);
    expect(upload?.with?.path).toContain("blob-report/");
    // The config is read as Playwright reads it on CI, in its own Node process (the scripts project does not
    // typecheck tests/e2e).
    const read = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'const { default: c } = await import("./tests/e2e/playwright.config.ts"); console.log(JSON.stringify(c));',
      ],
      { cwd: ROOT, env: { PATH: process.env.PATH, CI: "true" }, encoding: "utf8" },
    );
    expect(read.status, read.stderr).toBe(0);
    const config = JSON.parse(read.stdout) as { reporter: unknown; globalTimeout: number };
    expect(JSON.stringify(config.reporter)).toContain('"blob"');
    // Checkout, npm ci, the image and the servers take about three minutes before the run starts; leave five.
    const limit = (browser?.["timeout-minutes"] ?? 0) * 60_000;
    expect(config.globalTimeout).toBeGreaterThan(0);
    expect(config.globalTimeout).toBeLessThanOrEqual(limit - 5 * 60_000);
  });

  // Runs the merge step as Actions does (`bash -e`) over downloaded shard folders; npx stands in for Playwright and
  // logs its arguments, the JSON file it was told to write and the blobs in the folder it was given.
  function runMerge(present: (project: string, shard: number) => boolean) {
    const root = mkdtempSync(join(tmpdir(), "e2e-merge-"));
    const bin = join(root, "bin");
    const reports = join(root, "reports");
    const log = join(root, "calls.log");
    mkdirSync(bin);
    for (const project of E2E_PROJECTS) {
      for (let shard = 1; shard <= shards; shard++) {
        if (!present(project, shard)) continue;
        const dir = join(reports, `e2e-${project}-${shard}`, "blob-report");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `report-${shard}.zip`), "");
      }
    }
    const npx = `#!/bin/bash\necho "$* > $PLAYWRIGHT_JSON_OUTPUT_FILE < $(ls "\${@: -1}" | xargs)" >> "${log}"\n`;
    writeFileSync(join(bin, "npx"), npx, { mode: 0o755 });
    writeFileSync(log, "");
    const status = spawnSync("bash", ["-e", "-c", merge?.run ?? ""], {
      env: { PATH: `${bin}:${process.env.PATH}`, REPORTS: reports, E2E_SHARDS: String(shards) },
      stdio: "ignore",
    }).status;
    const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    rmSync(root, { recursive: true });
    return { status, calls, reports };
  }

  test("the_gate_merges_every_shard_of_each_browser_into_its_report", () => {
    expect(merge?.env?.REPORTS).toBe(`$${"{{"} runner.temp }}/e2e`);
    const { status, calls, reports } = runMerge(() => true);
    expect(status).toBe(0);
    const zips = Array.from({ length: shards }, (_, i) => `report-${i + 1}.zip`).join(" ");
    expect(calls).toEqual(
      E2E_PROJECTS.map(
        (project) =>
          `playwright merge-reports --reporter json ${reports}/${project}-blobs > ${reports}/${project}.json < ${zips}`,
      ),
    );
  });

  test("a_missing_shard_report_fails_the_gate", () => {
    for (const project of E2E_PROJECTS) {
      const { status } = runMerge((p, shard) => !(p === project && shard === shards));
      expect(status, project).not.toBe(0);
    }
  });
});
