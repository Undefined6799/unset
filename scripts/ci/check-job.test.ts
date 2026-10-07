// The required check job lints the whole repository before it tests (architecture ruling
// 2026-10-07-lint-clean-repo-duplicate). The unit test that ran `npm run lint` a second time is gone, so this pins the
// step it duplicated: removing the step, moving it after `npm test` or letting it fail softly is a visible loosening.
// GitHub Actions: a failing step stops the job unless the step or the job sets `continue-on-error`
// (docs.github.com, workflow syntax, jobs.<job_id>.continue-on-error and jobs.<job_id>.steps[*].continue-on-error).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const CI = join(import.meta.dirname, "..", "..", ".github", "workflows", "ci.yml");

type Step = { run?: unknown; "continue-on-error"?: unknown };
type Workflow = { jobs?: Record<string, { "continue-on-error"?: unknown; steps?: Step[] }> };

/** What keeps ci.yml's check job from linting the repository, as one line each; none means it does. */
function lintStepProblems(workflowText: string): string[] {
  const job = (parse(workflowText) as Workflow).jobs?.check;
  if (job === undefined) return ["no check job"];
  const steps = job.steps ?? [];
  const lint = steps.findIndex((step) => step.run === "npm run lint");
  const tests = steps.findIndex((step) => step.run === "npm test");
  const problems: string[] = [];
  if (lint === -1) problems.push("no step runs exactly npm run lint");
  if (tests === -1) problems.push("no step runs exactly npm test");
  if (lint !== -1 && tests !== -1 && lint > tests) problems.push("npm run lint runs after npm test");
  if (job["continue-on-error"] !== undefined) problems.push("the check job sets continue-on-error");
  if (lint !== -1 && steps[lint]?.["continue-on-error"] !== undefined) {
    problems.push("the lint step sets continue-on-error");
  }
  return problems;
}

const FIXTURE = `jobs:
  check:
    steps:
      - run: npm ci
      - run: npm run lint
      - run: npm test
`;

describe("check job", () => {
  test("check_job_runs_lint_before_tests", () => {
    expect(lintStepProblems(readFileSync(CI, "utf8"))).toEqual([]);
    expect(lintStepProblems(FIXTURE)).toEqual([]);
    // Each way the lint step could stop guarding the merge.
    expect(lintStepProblems(FIXTURE.replace("      - run: npm run lint\n", ""))).toEqual([
      "no step runs exactly npm run lint",
    ]);
    expect(lintStepProblems(FIXTURE.replace("run: npm run lint", "run: npm run lint || true"))).toEqual([
      "no step runs exactly npm run lint",
    ]);
    expect(
      lintStepProblems(
        FIXTURE.replace("      - run: npm run lint\n", "      - run: npm run lint\n        continue-on-error: true\n"),
      ),
    ).toEqual(["the lint step sets continue-on-error"]);
    expect(lintStepProblems(FIXTURE.replace("  check:\n", "  check:\n    continue-on-error: true\n"))).toEqual([
      "the check job sets continue-on-error",
    ]);
    const after = "jobs:\n  check:\n    steps:\n      - run: npm test\n      - run: npm run lint\n";
    expect(lintStepProblems(after)).toEqual(["npm run lint runs after npm test"]);
    expect(lintStepProblems("jobs:\n  audit:\n    steps: []\n")).toEqual(["no check job"]);
  });
});
