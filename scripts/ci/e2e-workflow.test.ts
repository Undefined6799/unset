// e2e.yml's gate (P0.07b). The browser legs and a11y run in parallel; the `e2e` job holds the required name, so it
// must be red whenever a leg did not succeed. A job whose if has no status function is skipped when a need fails, and
// a skipped required check reads as passing (expressions, "Status check functions"), hence always() and the result
// check, run here as Actions runs a step with no shell key: `bash -e` (workflow syntax, jobs.<job_id>.steps[*].shell).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { E2E_PROJECTS } from "../test/assert-tests-ran.ts";

type Step = { name?: string; run?: string; env?: Record<string, string>; "timeout-minutes"?: number };
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

// P0.07f, P0.07g: the browser install hung until the 30-minute job timeout in several runs on 2026-10-22. The job log
// showed the cause: azure.archive.ubuntu.com served `--with-deps` packages at a crawl (one file stalled 2.5 minutes).
// So apt gives up on a stalled connection after 20 s and retries each file 3 times; each attempt is cut at 4 minutes;
// before the second attempt the orphaned apt-get, which kept the dpkg lock and failed the P0.07f retry ("Could not get
// lock /var/lib/dpkg/lock-frontend"), is stopped and dpkg is left consistent. The step is capped at 9 minutes.
describe("browser install (P0.07f, P0.07g)", () => {
  const installs = Object.entries(wf.jobs).flatMap(([id, job]) =>
    (job.steps ?? []).filter((step) => step.run?.includes("playwright install")).map((step) => [id, step] as const),
  );

  // Runs the step as Actions does (`bash -e`) with stand-ins for timeout, npx, sudo and pgrep that log each call;
  // npx fails its first `failures` calls.
  function runInstall(script: string, failures: number): { status: number | null; calls: string[] } {
    const bin = mkdtempSync(join(tmpdir(), "e2e-install-"));
    const log = join(bin, "calls.log");
    const stub = (name: string, body: string) =>
      writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
    stub("timeout", 'shift 2; exec "$@"');
    stub("npx", `n=$(grep -c '^npx ' "${log}"); [ "$n" -gt ${failures} ]`);
    stub("sudo", "cat > /dev/null; exit 0");
    // apt-get is still alive for the first two checks after it is signalled, as it is while it shuts down.
    stub("pgrep", `[ "$(grep -c '^pgrep ' "${log}")" -le 2 ]`);
    stub("sleep", "exit 0");
    const status = spawnSync("bash", ["-e", "-c", script], {
      env: { PATH: `${bin}:${process.env.PATH}`, PROJECT: "webkit" },
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    }).status;
    const calls = readFileSync(log, "utf8").trim().split("\n");
    rmSync(bin, { recursive: true });
    return { status, calls };
  }

  test("every_browser_install_is_bounded_and_retried_once", () => {
    expect(installs.map(([id]) => id)).toEqual(["browser", "a11y"]);
    for (const [id, step] of installs) {
      expect(step["timeout-minutes"], id).toBe(9);
      const run = step.run ?? "";
      expect(run, id).toContain(`Acquire::http::Timeout "20";`);
      expect(run, id).toContain(`Acquire::Retries "3";`);
      expect(run, id).toMatch(/timeout --kill-after=10s 240s npx playwright install --with-deps /);
    }
  });

  test("a_healthy_install_runs_once", () => {
    for (const [id, step] of installs) {
      const { status, calls } = runInstall(step.run ?? "", 0);
      expect(status, id).toBe(0);
      expect(
        calls.filter((call) => call.startsWith("npx ")),
        id,
      ).toHaveLength(1);
      expect(
        calls.some((call) => call.includes("pkill")),
        id,
      ).toBe(false);
    }
  });

  test("a_stalled_install_stops_apt_then_retries_once", () => {
    for (const [id, step] of installs) {
      const { status, calls } = runInstall(step.run ?? "", 1);
      expect(status, id).toBe(0);
      const npx = calls.flatMap((call, i) => (call.startsWith("npx ") ? [i] : []));
      const pkill = calls.indexOf("sudo pkill -KILL -x apt-get");
      const dpkg = calls.indexOf("sudo dpkg --configure -a");
      // Codex on #1287: dpkg is repaired only once the signalled apt-get has gone, or it races apt-get for the lock.
      const lastWait = calls.lastIndexOf("pgrep -x apt-get");
      expect(npx, id).toHaveLength(2);
      expect(pkill, id).toBeGreaterThan(npx[0] ?? Infinity);
      expect(calls.filter((call) => call === "pgrep -x apt-get").length, id).toBe(3);
      expect(lastWait, id).toBeGreaterThan(pkill);
      expect(dpkg, id).toBeGreaterThan(lastWait);
      expect(npx[1], id).toBeGreaterThan(dpkg);
    }
  });

  test("two_failed_installs_fail_the_step", () => {
    for (const [id, step] of installs) {
      const { status, calls } = runInstall(step.run ?? "", 2);
      expect(status, id).not.toBe(0);
      expect(
        calls.filter((call) => call.startsWith("npx ")),
        id,
      ).toHaveLength(2);
    }
  });
});
