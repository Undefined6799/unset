// The required check job's gate (architecture rulings 2026-10-07-lint-clean-repo-duplicate and
// 2026-10-07-check-job-gate-pinning). A skipped required check counts as passing, so whatever decides whether the gate
// runs, and what it runs, is pinned by exact value here: the job's `if:`, every step through `npm test`, the
// environment those steps see, the root scripts they call, and a ci.yml that reads one way only. Any change to them is
// a visible check-path diff that edits this file; a loosening needs Alex's word.
// GitHub Actions workflow syntax (docs.github.com): jobs.<job_id>.if, jobs.<job_id>.steps[*], jobs.<job_id>.env,
// defaults, and jobs.<job_id>.continue-on-error. npm lifecycle scripts (docs.npmjs.com, "Scripts"): `npm ci` runs
// preinstall, install, postinstall, prepare and their pre/post forms.
// yaml 2.9.1 (node_modules/yaml): parseDocument with uniqueKeys, visit.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { isScalar, parseDocument, visit } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
const CI = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const PACKAGE = readFileSync(join(ROOT, "package.json"), "utf8");

type Step = Record<string, unknown>;
type Job = { if?: unknown; env?: Record<string, unknown>; defaults?: unknown; steps?: Step[]; [key: string]: unknown };
type Workflow = { env?: unknown; defaults?: unknown; jobs?: Record<string, Job> };

const CHECK_IF = "github.event_name != 'pull_request' || github.event.pull_request.draft == false";
/** Every step from the first through `npm test`, in order; `uses` is the action path and a 40-hex ref (`@<sha>`). */
const GATE_STEPS: Step[] = [
  { uses: "actions/checkout@<sha>", with: { "persist-credentials": false, "fetch-depth": 0 } },
  { uses: "actions/setup-node@<sha>", with: { "node-version-file": ".nvmrc", cache: "npm" } },
  { run: "npm ci" },
  { run: "npm run typecheck" },
  { run: "npm run lint" },
  {
    name: "Compare a pull request with the base it was merged onto",
    if: "github.event_name == 'pull_request'",
    run: 'echo "BASE_SHA=$(git rev-parse HEAD^1)" >> "$GITHUB_ENV"',
  },
  { run: "npm run guards" },
  { run: "npm test" },
];
const CHECK_ENV = ["BASE_SHA", "RENOVATE_IMAGE"];
const ROOT_SCRIPTS = {
  typecheck: "tsc -b",
  lint: "biome ci . && depcruise --config scripts/lint/.dependency-cruiser.cjs .",
  guards: "vitest run scripts/guards",
  test: "node scripts/test/run.ts",
};
/** The scripts `npm ci` runs on its own (docs.npmjs.com, "Scripts", npm ci). */
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "preprepare", "postprepare"];

/** ci.yml as GitHub reads it, or why it might read differently: no anchor, alias, merge key or duplicate key. */
function readWorkflow(text: string): { workflow: Workflow; problems: string[] } {
  const doc = parseDocument(text, { uniqueKeys: true, merge: false });
  const problems = doc.errors.map((error) => `yaml: ${error.code}`);
  visit(doc, {
    Alias: () => void problems.push("alias"),
    Node: (_, node) => void (node.anchor && problems.push("anchor")),
    Pair: (_, pair) => void (isScalar(pair.key) && pair.key.value === "<<" && problems.push("merge key")),
  });
  return { workflow: problems.length === 0 ? (doc.toJS() as Workflow) : {}, problems };
}

const checkJob = (text: string): Job => readWorkflow(text).workflow.jobs?.check ?? {};

/**
 * A step with its `uses` split on the last `@`: a 40-hex ref becomes `@<sha>`, so Renovate's SHA bumps compare equal.
 * Anything else (no `@`, an empty ref, a tag, a short SHA, the literal `@<sha>`) is marked unpinned, so it never
 * matches the pinned step.
 */
function normalised(step: Step): Step {
  if (typeof step.uses !== "string") return step;
  const at = step.uses.lastIndexOf("@");
  const path = step.uses.slice(0, at);
  const ref = step.uses.slice(at + 1);
  return at > 0 && /^[0-9a-f]{40}$/.test(ref)
    ? { ...step, uses: `${path}@<sha>` }
    : { ...step, uses: `unpinned:${step.uses}` };
}

const ifProblems = (text: string): string[] =>
  checkJob(text).if === CHECK_IF ? [] : ["the check job's if differs from the pinned condition"];

function gateStepProblems(text: string): string[] {
  const steps = checkJob(text).steps ?? [];
  const tests = steps.findIndex((step) => step.run === "npm test");
  if (tests === -1) return ["no step runs exactly npm test"];
  const gate = steps.slice(0, tests + 1).map(normalised);
  return JSON.stringify(gate) === JSON.stringify(GATE_STEPS) ? [] : ["the gate steps differ from the pinned sequence"];
}

function envProblems(text: string): string[] {
  const { workflow } = readWorkflow(text);
  const job = workflow.jobs?.check ?? {};
  const problems: string[] = [];
  if (workflow.defaults !== undefined) problems.push("workflow defaults");
  if (workflow.env !== undefined) problems.push("workflow env");
  if (job.defaults !== undefined) problems.push("check job defaults");
  const keys = Object.keys(job.env ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(CHECK_ENV)) problems.push(`check job env keys: ${keys.join(", ")}`);
  return problems;
}

/** Every `npm_config_*` env key in ci.yml (any case), at workflow, job or step level in any job: npm reads them as config. */
function npmConfigEnvProblems(text: string): string[] {
  const { workflow } = readWorkflow(text);
  const npmConfig = (where: string, env: unknown): string[] =>
    Object.keys(typeof env === "object" && env !== null ? env : {})
      .filter((key) => /^npm_config_/i.test(key))
      .map((key) => `${where} sets ${key}`);
  const problems = npmConfig("the workflow", workflow.env);
  for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
    problems.push(...npmConfig(`job ${id}`, job.env));
    for (const [i, step] of (job.steps ?? []).entries())
      problems.push(...npmConfig(`job ${id} step ${i + 1}`, step.env));
  }
  return problems;
}

function scriptProblems(text: string): string[] {
  const scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {};
  const changed = Object.entries(ROOT_SCRIPTS).filter(([name, value]) => scripts[name] !== value);
  const lifecycle = LIFECYCLE.filter((name) => name in scripts);
  return [...changed.map(([name]) => `script ${name} changed`), ...lifecycle.map((name) => `lifecycle script ${name}`)];
}

/** What keeps ci.yml's check job from linting the repository, as one line each; none means it does. */
function lintStepProblems(workflowText: string): string[] {
  const job = (parseDocument(workflowText).toJS() as Workflow).jobs?.check;
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
/** The real ci.yml with one edit; every red fixture below starts from the file GitHub runs. */
const edited = (from: string, to: string): string => {
  expect(CI, `fixture anchor: ${from}`).toContain(from);
  return CI.replace(from, to);
};
const CHECKOUT = /actions\/checkout@[0-9a-f]{40}/.exec(CI)?.[0] ?? "";
const LINT = "      - run: npm run lint\n";
const TEST = "      - run: npm test\n";

describe("check job", () => {
  test("check_job_runs_lint_before_tests", () => {
    expect(lintStepProblems(CI)).toEqual([]);
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

  test("check_job_if_exact", () => {
    expect(ifProblems(CI)).toEqual([]);
    const differs = ["the check job's if differs from the pinned condition"];
    expect(ifProblems(edited(`if: ${CHECK_IF}`, `if: ${CHECK_IF} && false`))).toEqual(differs);
    expect(ifProblems(edited(`    if: ${CHECK_IF}\n`, ""))).toEqual(differs);
  });

  test("check_job_gate_steps_exact", () => {
    expect(gateStepProblems(CI)).toEqual([]);
    // Renovate's SHA bump of the same action changes nothing the gate runs (amendment 14:15Z).
    expect(gateStepProblems(edited(CHECKOUT, `actions/checkout@${"f".repeat(40)}`))).toEqual([]);
    const differ = ["the gate steps differ from the pinned sequence"];
    for (const red of [
      edited(CHECKOUT, "actions/checkout@v7"),
      edited(CHECKOUT, "actions/checkout"),
      edited(CHECKOUT, "actions/checkout@"),
      edited(CHECKOUT, "actions/checkout@3d3c42e"),
      edited(CHECKOUT, "actions/checkout@<sha>"),
      edited(CHECKOUT, `actions/checkout@${"f".repeat(40)}@v7`),
      edited(CHECKOUT, `someone/checkout@${"f".repeat(40)}`),
      edited(LINT, "      - run: npm run lint\n        if: false\n"),
      edited(TEST, "      - run: npm test\n        shell: sh\n"),
      edited(LINT, `${LINT}      - run: echo inserted\n`),
      edited(LINT, ""),
      edited("persist-credentials: false", "persist-credentials: true"),
    ]) {
      expect(gateStepProblems(red)).toEqual(differ);
    }
    expect(gateStepProblems(edited(TEST, ""))).toEqual(["no step runs exactly npm test"]);
  });

  test("check_job_no_defaults_or_extra_env", () => {
    expect(envProblems(CI)).toEqual([]);
    expect(envProblems(edited("permissions: {}\n", "permissions: {}\ndefaults:\n  run:\n    shell: sh\n"))).toEqual([
      "workflow defaults",
    ]);
    expect(envProblems(edited("permissions: {}\n", "permissions: {}\nenv:\n  NODE_OPTIONS: --require=x\n"))).toEqual([
      "workflow env",
    ]);
    expect(
      envProblems(
        edited("    timeout-minutes: 15\n", "    timeout-minutes: 15\n    defaults:\n      run:\n        shell: sh\n"),
      ),
    ).toEqual(["check job defaults"]);
    expect(envProblems(edited("    env:\n", "    env:\n      npm_config_script_shell: /bin/true\n"))).toEqual([
      "check job env keys: BASE_SHA, RENOVATE_IMAGE, npm_config_script_shell",
    ]);
  });

  // P0.05d: npm reads any npm_config_* variable as config, which could undo .npmrc (ignore-scripts, the @unset registry)
  // in whichever job sets it; none may, in any job.
  test("ci_workflow_sets_no_npm_config_env", () => {
    expect(npmConfigEnvProblems(CI)).toEqual([]);
    expect(
      npmConfigEnvProblems(
        edited("permissions: {}\n", "permissions: {}\nenv:\n  NPM_CONFIG_IGNORE_SCRIPTS: 'false'\n"),
      ),
    ).toEqual(["the workflow sets NPM_CONFIG_IGNORE_SCRIPTS"]);
    expect(npmConfigEnvProblems(edited("    env:\n", "    env:\n      npm_config_script_shell: /bin/true\n"))).toEqual([
      "job check sets npm_config_script_shell",
    ]);
    const step =
      "jobs:\n  audit:\n    steps:\n      - run: npm ci\n        env:\n          Npm_Config_Registry: https://registry.example\n";
    expect(npmConfigEnvProblems(step)).toEqual(["job audit step 1 sets Npm_Config_Registry"]);
  });

  test("root_package_scripts_pinned", () => {
    expect(scriptProblems(PACKAGE)).toEqual([]);
    const pkg = JSON.parse(PACKAGE) as { scripts: Record<string, string> };
    const withScripts = (scripts: Record<string, string>) => JSON.stringify({ ...pkg, scripts });
    expect(scriptProblems(withScripts({ ...pkg.scripts, lint: "true" }))).toEqual(["script lint changed"]);
    expect(scriptProblems(withScripts({ ...pkg.scripts, prepare: "node x.js" }))).toEqual(["lifecycle script prepare"]);
    const { test: _test, ...noTest } = pkg.scripts;
    expect(scriptProblems(withScripts(noTest))).toEqual(["script test changed"]);
  });

  test("ci_workflow_has_no_aliases_or_duplicate_keys", () => {
    expect(readWorkflow(CI).problems).toEqual([]);
    expect(
      readWorkflow(edited("    timeout-minutes: 15\n", "    timeout-minutes: 15\n    timeout-minutes: 20\n")).problems,
    ).toEqual(["yaml: DUPLICATE_KEY"]);
    expect(
      readWorkflow(edited("    permissions:\n      contents: read\n", "    permissions: &p\n      contents: read\n"))
        .problems,
    ).toEqual(["anchor"]);
    const aliased = "x: &a {run: npm test}\njobs:\n  check:\n    steps: [*a]\n";
    expect(readWorkflow(aliased).problems).toEqual(["anchor", "alias"]);
    expect(readWorkflow("jobs:\n  check:\n    <<: {if: 'true'}\n").problems).toEqual(["merge key"]);
  });
});
