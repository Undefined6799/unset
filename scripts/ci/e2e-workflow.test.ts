// e2e.yml's gate (P0.07b). The browser legs and a11y run in parallel; the `e2e` job holds the required name, so it
// must be red whenever a leg did not succeed. A job whose if has no status function is skipped when a need fails, and
// a skipped required check reads as passing (expressions, "Status check functions"), hence always() and the result
// check, run here as Actions runs a step with no shell key: `bash -e` (workflow syntax, jobs.<job_id>.steps[*].shell).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { E2E_PROJECTS } from "../test/assert-tests-ran.ts";

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = {
  needs?: string[];
  if?: string;
  strategy?: { "fail-fast"?: boolean; matrix?: { project?: string[] } };
  steps?: Step[];
};
const ROOT = join(import.meta.dirname, "..", "..");
const wf = parse(readFileSync(join(ROOT, ".github", "workflows", "e2e.yml"), "utf8")) as { jobs: Record<string, Job> };
const DRAFT = "(github.event_name != 'pull_request' || github.event.pull_request.draft == false)";

describe("e2e gate (P0.07b)", () => {
  const gate = wf.jobs.e2e;

  test("e2e_gate_runs_always_and_needs_every_leg", () => {
    expect(gate?.needs).toEqual(["browser", "a11y"]);
    expect(gate?.if).toBe(`always() && ${DRAFT}`);
  });

  test("e2e_gate_fails_unless_every_leg_succeeded", () => {
    const step = gate?.steps?.[0];
    if (step?.run === undefined) throw new Error("no result check");
    expect(step.env).toEqual({
      BROWSER_RESULT: `$${"{{"} needs.browser.result }}`,
      A11Y_RESULT: `$${"{{"} needs.a11y.result }}`,
    });
    const check = (browser: string, a11y: string) =>
      spawnSync("bash", ["-e", "-c", step.run ?? ""], {
        env: { PATH: process.env.PATH, BROWSER_RESULT: browser, A11Y_RESULT: a11y },
        encoding: "utf8",
      }).status;
    expect(check("success", "success")).toBe(0);
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      expect(check(result, "success"), `browser ${result}`).not.toBe(0);
      expect(check("success", result), `a11y ${result}`).not.toBe(0);
    }
  });

  test("e2e_gate_checks_one_report_per_project", () => {
    expect(wf.jobs.browser?.strategy?.["fail-fast"]).toBe(false);
    expect(wf.jobs.browser?.strategy?.matrix?.project).toEqual([...E2E_PROJECTS]);
    const run = (gate?.steps ?? []).map((step) => step.run ?? "").join("\n");
    for (const project of E2E_PROJECTS) {
      expect(run).toContain(`"${project}=$REPORTS/e2e-${project}/tests/e2e/report.json"`);
    }
  });
});
