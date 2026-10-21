import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  discoverSpecs,
  E2E_PROJECTS,
  type PlaywrightReport,
  parseReportArg,
  problems,
  problemsAcross,
  SKIP_ALLOWANCE,
} from "./assert-tests-ran.ts";

const today = "2026-10-17";

function report(status: "expected" | "skipped", file = "a11y.spec.ts"): PlaywrightReport {
  return {
    suites: [
      {
        specs: [
          {
            title: "axe_matrix_green / cookie-dark",
            file,
            tests: [{ status, results: [{ status: status === "skipped" ? "skipped" : "passed" }] }],
          },
        ],
      },
    ],
  };
}

describe("assert_tests_ran_skip_fails", () => {
  test("a skipped test without an allowance exits as a problem", () => {
    expect(problems(report("skipped"), ["a11y.spec.ts"], [], today)).toEqual([
      "skipped without an allowance: axe_matrix_green / cookie-dark",
    ]);
  });

  test("an expired allowance fails on its own", () => {
    const allowance = [{ title: "unused", reason: "fixture", expires: "2000-01-01" }];
    expect(problems(report("expected"), ["a11y.spec.ts"], allowance, today)).toEqual([
      "skip allowance expired: unused (2000-01-01)",
    ]);
  });

  test("a discovered spec missing from the report fails", () => {
    expect(problems(report("expected"), ["a11y.spec.ts", "missing.spec.ts"], [], today)).toEqual([
      "discovered test file did not run: missing.spec.ts",
    ]);
  });

  test("a passing report matches the files that ran", () => {
    expect(problems(report("expected"), ["a11y.spec.ts"], [], today)).toEqual([]);
  });

  test("the committed allowance is empty", () => {
    expect(SKIP_ALLOWANCE).toEqual([]);
  });
});

const ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(import.meta.dirname, "assert-tests-ran.ts");
const PROJECTS = ["chromium", "webkit"];

function ran(project: string, file = "a11y.spec.ts"): PlaywrightReport {
  return {
    suites: [
      { specs: [{ title: `t ${file}`, file, tests: [{ status: "expected", projectName: project, results: [] }] }] },
    ],
  };
}

describe("assert_tests_ran_across_jobs", () => {
  test("specs from every job's report count together", () => {
    const reports = [
      { project: "chromium", name: "c.json", report: ran("chromium", "headers.spec.ts") },
      { project: "webkit", name: "w.json", report: ran("webkit") },
    ];
    expect(problemsAcross(reports, PROJECTS, ["a11y.spec.ts", "headers.spec.ts"], [], today)).toEqual([]);
  });

  test("a spec no job ran fails", () => {
    const reports = [
      { project: "chromium", name: "c.json", report: ran("chromium") },
      { project: "webkit", name: "w.json", report: ran("webkit") },
    ];
    expect(problemsAcross(reports, PROJECTS, ["a11y.spec.ts", "headers.spec.ts"], [], today)).toEqual([
      "discovered test file did not run: headers.spec.ts",
    ]);
  });

  test("a job whose report ran no tests fails", () => {
    const reports = [
      { project: "chromium", name: "c.json", report: ran("chromium") },
      { project: "webkit", name: "w.json", report: { suites: [] } },
    ];
    expect(problemsAcross(reports, PROJECTS, ["a11y.spec.ts"], [], today)).toEqual(["report ran no tests: w.json"]);
  });

  test("a missing, duplicated or unexpected project fails", () => {
    const twice = [
      { project: "chromium", name: "c.json", report: ran("chromium") },
      { project: "chromium", name: "c2.json", report: ran("chromium") },
      { project: "firefox", name: "f.json", report: ran("firefox") },
    ];
    expect(problemsAcross(twice, PROJECTS, ["a11y.spec.ts"], [], today)).toEqual([
      "more than one report for project: chromium",
      "no report for project: webkit",
      "unexpected project: firefox",
    ]);
  });

  test("a report holding another project's tests fails", () => {
    const reports = [
      { project: "chromium", name: "c.json", report: ran("chromium") },
      { project: "webkit", name: "w.json", report: ran("chromium") },
    ];
    expect(problemsAcross(reports, PROJECTS, ["a11y.spec.ts"], [], today)).toEqual([
      'w.json holds tests of project "chromium", not webkit',
    ]);
  });

  test("no reports at all fails", () => {
    expect(problemsAcross([], PROJECTS, ["a11y.spec.ts"], [], today)).toEqual([
      "no report for project: chromium",
      "no report for project: webkit",
      "discovered test file did not run: a11y.spec.ts",
    ]);
  });

  // Read as text: the config imports @playwright/test, which is outside this project's tsconfig.
  test("E2E_PROJECTS are the config's projects", () => {
    const text = readFileSync(join(ROOT, "tests/e2e/playwright.config.ts"), "utf8");
    const block = text.slice(text.indexOf("projects: ["), text.indexOf("],", text.indexOf("projects: [")));
    expect([...block.matchAll(/\{ name: "([a-z]+)"/g)].map((match) => match[1])).toEqual([...E2E_PROJECTS]);
  });

  test("a report argument is project=path", () => {
    expect(parseReportArg("webkit=/tmp/r.json")).toEqual({ project: "webkit", path: "/tmp/r.json" });
    for (const bad of ["/tmp/r.json", "=/tmp/r.json", "webkit="]) expect(() => parseReportArg(bad)).toThrow();
  });
});

describe("assert_tests_ran_cli", () => {
  function cli(args: (dir: string) => string[], reports: Record<string, PlaywrightReport>) {
    const dir = mkdtempSync(join(tmpdir(), "assert-tests-ran-"));
    for (const [file, report] of Object.entries(reports)) writeFileSync(join(dir, file), JSON.stringify(report));
    return spawnSync(process.execPath, [SCRIPT, ...args(dir)], { cwd: ROOT, encoding: "utf8" });
  }

  const specs = discoverSpecs(join(ROOT, "tests/e2e"));
  const full = (project: string): PlaywrightReport => ({
    suites: specs.map((file) => ({
      specs: [{ title: `t ${file}`, file, tests: [{ status: "expected", projectName: project, results: [] }] }],
    })),
  });
  const all = (dir: string) => E2E_PROJECTS.map((project) => `${project}=${join(dir, `${project}.json`)}`);
  const reports = Object.fromEntries(E2E_PROJECTS.map((project) => [`${project}.json`, full(project)]));

  test("every project's report, all specs covered, passes", () => {
    const run = cli(all, reports);
    expect(run.status, run.stderr).toBe(0);
  });

  test("a missing project's report fails", () => {
    const run = cli((dir) => all(dir).slice(0, 2), reports);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no report for project: webkit");
  });

  test("the same report passed for two projects fails", () => {
    const run = cli((dir) => [...all(dir).slice(0, 2), `webkit=${join(dir, "firefox.json")}`], reports);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('holds tests of project "firefox", not webkit');
  });

  test("no arguments fails", () => {
    const run = cli(() => [], {});
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no report for project: chromium");
  });
});
