import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  compare,
  discoverByGlob,
  executedFiles,
  filesToRun,
  imagesPlan,
  LIST_ARGS,
  type Mode,
  main,
  modeFor,
  skippedCases,
  skippedOnly,
  strayTestFiles,
  type VitestJsonReport,
  vitestArgs,
} from "./run.ts";

const REPO = join(import.meta.dirname, "..", "..");
const CONFIG = join(REPO, "vitest.config.ts");
const PASSING = 'import { expect, test } from "vitest";\ntest("ok", () => expect(1).toBe(1));\n';

const roots: string[] = [];
function fixture(files: Record<string, string>, withModules = false): string {
  const root = mkdtempSync(join(tmpdir(), "run-test-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  if (withModules) symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

type Case = { fullName: string; status: "passed" | "failed" | "skipped" | "pending" | "todo" | "disabled" };
const report = (files: Record<string, Case["status"][]>): VitestJsonReport => ({
  testResults: Object.entries(files).map(([name, statuses]) => ({
    name: `/repo/${name}`,
    status: statuses.includes("failed") ? "failed" : "passed",
    assertionResults: statuses.map((status, i) => ({ fullName: `t${i}`, status })),
  })),
});
const none = new Set<string>();

/** Runs main() quietly and returns its exit code and what it printed to stderr. */
async function runMain(
  root: string,
  mode: Mode = "local",
  dockerReady = () => true,
): Promise<{ code: number; err: string }> {
  const lines: string[] = [];
  const err = vi.spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));
  try {
    return { code: await main({ root, config: CONFIG, quiet: true, mode, dockerReady }), err: lines.join("\n") };
  } finally {
    err.mockRestore();
  }
}

describe("compare", () => {
  test("compare_all_good", () => {
    const outcome = compare(["a", "b"], ["a", "b"], new Set(["a", "b"]), none, [], []);
    expect(outcome).toEqual({ notListed: [], notExecuted: [], allSkipped: [], skippedCases: [], stray: [] });
  });

  test("compare_not_listed", () => {
    expect(compare(["a", "b"], ["a"], new Set(["a"]), none, [], []).notListed).toEqual(["b"]);
  });

  test("compare_import_error", () => {
    const r = report({ a: ["passed"] });
    expect(compare(["a", "b"], ["a", "b"], executedFiles("/repo", r), none, [], []).notExecuted).toEqual(["b"]);
  });

  test("compare_empty_file", () => {
    const r = report({ c: [] });
    const outcome = compare(["c"], ["c"], executedFiles("/repo", r), skippedOnly("/repo", r), [], []);
    expect(outcome.notExecuted).toEqual(["c"]);
  });

  test("compare_all_skipped", () => {
    const r = report({ c: ["todo", "skipped"] });
    const outcome = compare(["c"], ["c"], executedFiles("/repo", r), skippedOnly("/repo", r), [], []);
    expect(outcome.allSkipped).toEqual(["c"]);
    expect(outcome.notExecuted).toEqual([]);
  });

  test("compare_skipped_case_in_passing_file", () => {
    const r = report({ c: ["passed", "passed", "passed", "todo"] });
    expect(skippedCases("/repo", r)).toEqual(["c > t3"]);
  });
});

describe("discovery", () => {
  test("discover_includes_deploy_and_docs", () => {
    const root = fixture({
      "deployment/a.test.ts": "",
      "docs/b.test.ts": "",
      "node_modules/c.test.ts": "",
      "scripts/guards/fixtures/d.test.ts": "",
    });
    const glob = discoverByGlob(root);
    expect(glob).toEqual(["deployment/a.test.ts", "docs/b.test.ts"]);
    expect(compare(glob, ["docs/b.test.ts"], new Set(["docs/b.test.ts"]), none, [], []).notListed).toEqual([
      "deployment/a.test.ts",
    ]);
  });

  test("stray_test_files", () => {
    const root = fixture({ "apps/web/a.spec.ts": "", "domains/x/b.test.js": "", "tests/e2e/c.spec.ts": "" });
    expect(strayTestFiles(root)).toEqual(["apps/web/a.spec.ts", "domains/x/b.test.js"]);
  });

  test("list_uses_files_only", () => {
    const argv = vitestArgs(LIST_ARGS, { root: "/repo", config: CONFIG });
    expect(argv.slice(1, 4)).toEqual(["list", "--filesOnly", "--json"]);
  });
});

describe("end to end with real Vitest", { timeout: 60_000 }, () => {
  test("end_to_end_planted_empty_file", async () => {
    const { code, err } = await runMain(fixture({ "domains/x/a.test.ts": PASSING, "domains/x/x.test.ts": "" }, true));
    expect(code).toBe(1);
    expect(err).toMatch(/\(notExecuted\):\n\s+domains\/x\/x\.test\.ts/);
  });

  test("only_is_rejected", async () => {
    const only = 'import { expect, test } from "vitest";\ntest.only("o", () => expect(1).toBe(1));\n';
    expect((await runMain(fixture({ "domains/x/a.test.ts": PASSING, "domains/x/o.test.ts": only }, true))).code).toBe(
      1,
    );
  });

  test("skip_in_passing_file_is_rejected", async () => {
    const body = `${PASSING}test.skip("later", () => {});\n`;
    const { code, err } = await runMain(fixture({ "domains/x/s.test.ts": body }, true));
    expect(code).toBe(1);
    expect(err).toContain("domains/x/s.test.ts > later");
  });

  test("failing_before_all_is_not_executed", async () => {
    const body =
      'import { beforeAll, expect, test } from "vitest";\nbeforeAll(() => { throw new Error("x"); });\ntest("t", () => expect(1).toBe(1));\n';
    const { code, err } = await runMain(fixture({ "domains/x/b.test.ts": body }, true));
    expect(code).toBe(1);
    expect(err).toMatch(/\(notExecuted\):\n\s+domains\/x\/b\.test\.ts/);
  });

  test("clean_tree_passes", async () => {
    expect((await runMain(fixture({ "domains/x/a.test.ts": PASSING }, true))).code).toBe(0);
  });

  test("root_level_test_file_is_not_listed", async () => {
    // Each Vitest project selects one decision-34 folder (P1.01), so a test file anywhere else is reported.
    const { code, err } = await runMain(fixture({ "domains/x/a.test.ts": PASSING, "r.test.ts": PASSING }, true));
    expect(code).toBe(1);
    expect(err).toMatch(/\(notListed\):\n\s+r\.test\.ts/);
  });

  test("typecheck_includes_tests", () => {
    const read = (file: string): string => readFileSync(join(REPO, file), "utf8");
    const bad = "const n: number = 'not a number';\nexport {};\n";
    const root = fixture(
      {
        "tsconfig.json": read("tsconfig.json"),
        "tsconfig.base.json": read("tsconfig.base.json"),
        // Without its project references: the fixture holds only these files, and the include list is under test.
        "scripts/tsconfig.json": JSON.stringify({ ...JSON.parse(read("scripts/tsconfig.json")), references: [] }),
        "scripts/a.test.mts": bad,
        "scripts/b.test.tsx": bad,
      },
      true,
    );
    const tsc = spawnSync(join(REPO, "node_modules", ".bin", "tsc"), ["-b"], { cwd: root, encoding: "utf8" });
    expect(tsc.status).not.toBe(0);
    expect(tsc.stdout).toContain("scripts/a.test.mts");
    expect(tsc.stdout).toContain("scripts/b.test.tsx");
  });
});

// P1.28r: run.ts alone decides whether the images project runs (step book 2026-10-07
// p123d-p128i-p128r-test-timing, amendment 1).
describe("images project", { timeout: 60_000 }, () => {
  const glob = ["deployment/e/b.image.test.ts", "domains/x/a.test.ts", "tests/integration/c.image.test.ts"];
  const FAILING = 'import { expect, test } from "vitest";\ntest("no", () => expect(1).toBe(2));\n';

  test("ci_runs_image_project", async () => {
    expect(modeFor({ CI: "true" }, [])).toBe("ci");
    const plan = imagesPlan("ci", glob);
    expect(plan.runs).toEqual([["--project=!images"], ["--project=images"]]);
    expect(plan.expected).toEqual(glob);
    expect(plan.problem).toBeNull();
    const units = { "domains/x/a.test.ts": PASSING };
    expect((await runMain(fixture({ ...units, "domains/x/b.image.test.ts": PASSING }, true), "ci")).code).toBe(0);
    const failing = await runMain(fixture({ ...units, "domains/x/b.image.test.ts": FAILING }, true), "ci");
    expect(failing.code).toBe(1);
    // The no-skip rule holds inside the images run too.
    const body = `${PASSING}test.skip("later", () => {});\n`;
    const skipped = await runMain(fixture({ ...units, "domains/x/b.image.test.ts": body }, true), "ci");
    expect(skipped.code).toBe(1);
    expect(skipped.err).toContain("domains/x/b.image.test.ts > later");
  });

  test("local_reports_images_not_run", async () => {
    expect(modeFor({}, [])).toBe("local");
    expect(modeFor({ CI: "false" }, [])).toBe("local");
    expect(modeFor({}, ["--images"])).toBe("images");
    expect(() => modeFor({}, ["--image"])).toThrow("unknown argument --image");
    const plan = imagesPlan("local", glob);
    expect(plan.runs).toEqual([["--project=!images"]]);
    expect(plan.expected).toEqual(["domains/x/a.test.ts"]);
    expect(plan.notRun).toBe("images project: not run locally (2 files; CI runs them; npm run test:images to run)");
    // A failing image test is not started, and is reported neither as not executed nor as skipped.
    const root = fixture({ "domains/x/a.test.ts": PASSING, "domains/x/b.image.test.ts": FAILING }, true);
    const { code, err } = await runMain(root);
    expect(code).toBe(0);
    expect(err).toContain("images project: not run locally (1 file; CI runs them; npm run test:images to run)");
    expect(err).not.toContain("notExecuted");
    // The opt-in runs only the images project under CI's rules, and needs Docker.
    expect(imagesPlan("images", glob).runs).toEqual([["--project=images"]]);
    expect((await runMain(root, "images")).code).toBe(1);
    const noDocker = await runMain(root, "images", () => false);
    expect(noDocker.code).toBe(1);
    expect(noDocker.err).toContain("npm run test:images needs Docker");
  });

  // Amendment 2 (architecture, 2026-10-07 21:45Z): an earlier CI step can rewrite CI through $GITHUB_ENV, but not
  // GITHUB_ACTIONS, so CI mode cannot be switched off from inside the job.
  test("ci_mode_from_github_actions", () => {
    expect(modeFor({ GITHUB_ACTIONS: "true", CI: "true" }, [])).toBe("ci");
    expect(modeFor({ GITHUB_ACTIONS: "true", CI: "true" }, ["--images"])).toBe("images");
  });

  test("inconsistent_ci_env_fails", () => {
    const inconsistent = "CI environment is inconsistent: GITHUB_ACTIONS is set and CI is not true";
    expect(() => modeFor({ GITHUB_ACTIONS: "true" }, [])).toThrow(inconsistent);
    expect(() => modeFor({ GITHUB_ACTIONS: "true", CI: "false" }, [])).toThrow(inconsistent);
    expect(() => modeFor({ GITHUB_ACTIONS: "false", CI: "1" }, ["--images"])).toThrow(inconsistent);
    // run.ts stops at start, before any discovery or Vitest run.
    const env = { PATH: process.env.PATH ?? "", GITHUB_ACTIONS: "true", CI: "false" };
    const run = spawnSync(process.execPath, [join(REPO, "scripts/test/run.ts")], {
      cwd: fixture({}),
      env,
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe(inconsistent);
  });

  test("listed_but_undiscovered_file_fails_in_ci", () => {
    // A file Vitest lists that the glob did not discover (its exclude drifting from SKIP_DIRS) must still have run.
    const glob = ["domains/x/a.test.ts"];
    const listed = ["domains/x/a.test.ts", "vendor/x/b.test.ts"];
    const toRun = filesToRun("ci", listed, glob);
    expect(toRun).toEqual(listed);
    expect(compare(glob, listed, new Set(glob), none, [], [], toRun).notExecuted).toEqual(["vendor/x/b.test.ts"]);
    // Locally and in the opt-in, only the files the run starts are checked.
    expect(filesToRun("local", listed, glob)).toEqual(glob);
    expect(filesToRun("images", ["d/a.image.test.ts", ...listed], ["d/a.image.test.ts"])).toEqual([
      "d/a.image.test.ts",
    ]);
  });

  test("empty_images_project_fails_in_ci", async () => {
    const problem = "the images project has no *.image.test.ts file to run";
    expect(imagesPlan("ci", ["domains/x/a.test.ts"]).problem).toBe(problem);
    expect(imagesPlan("images", ["domains/x/a.test.ts"]).problem).toBe(problem);
    expect(imagesPlan("local", ["domains/x/a.test.ts"]).problem).toBeNull();
    const { code, err } = await runMain(fixture({ "domains/x/a.test.ts": PASSING }, true), "ci");
    expect(code).toBe(1);
    expect(err).toContain(problem);
  });
});

describe("repository settings", () => {
  test("retry_zero", async () => {
    const config = (await import("../../vitest.config.ts")).default as { test?: { retry?: number } };
    expect(config.test?.retry).toBe(0);
  });

  test("integration_global_setup_file_exists", async () => {
    type Project = { test?: { name?: string; globalSetup?: string | string[] } };
    const config = (await import("../../vitest.config.ts")).default as { test?: { projects?: Project[] } };
    const setups = (config.test?.projects ?? []).flatMap((p) => [p.test?.globalSetup ?? []].flat());
    expect(setups).toContain("tests/integration/setup/pg.setup.ts");
    for (const setup of setups) expect(existsSync(join(REPO, setup)), setup).toBe(true);
  });

  test("npmrc_lines", () => {
    const lines = readFileSync(join(REPO, ".npmrc"), "utf8").split("\n");
    expect(lines).toContain("ignore-scripts=true");
    expect(lines).toContain("@unset:registry=https://127.0.0.1:9/");
  });

  test("typescript_single_major", () => {
    const ls = spawnSync("npm", ["ls", "typescript", "--all", "--json"], { cwd: REPO, encoding: "utf8" });
    expect(ls.status).toBe(0);
    type Node = { version?: string; dependencies?: Record<string, Node> };
    const versions: (string | undefined)[] = [];
    const walk = (node: Node): void => {
      for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
        if (name === "typescript") versions.push(dep.version);
        walk(dep);
      }
    };
    walk(JSON.parse(ls.stdout) as Node);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(v).toMatch(/^7\.0\./);
  });
});
