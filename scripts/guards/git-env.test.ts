// P0.09j: guard fixtures never touch the repository a caller's GIT_* variables point at. Git exports GIT_DIR,
// GIT_WORK_TREE and the like to hooks "so that Git commands run by the hook can correctly locate the repository"
// (githooks(5), git v2.43.0 Documentation/githooks.txt:30-35), and the pre-commit hook runs these tests.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { withoutGitEnv } from "./git-env.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** The guard test files that build throwaway repositories with `git init`. */
const fixtureRepoTests = (): string[] =>
  readdirSync(join(ROOT, "scripts", "guards"))
    .filter((f) => f.endsWith(".test.ts") && f !== "git-env.test.ts")
    .filter((f) => /"init"/.test(readFileSync(join(ROOT, "scripts", "guards", f), "utf8")))
    .map((f) => `scripts/guards/${f}`);

test("fixture_helper_strips_git_env", () => {
  const env = { PATH: "/bin", GIT_DIR: "/r/.git", GIT_INDEX_FILE: "/r/.git/index", GIT_WORK_TREE: "/r", HOME: "/h" };
  expect(withoutGitEnv(env)).toEqual({ PATH: "/bin", HOME: "/h" });
  // Every test file that makes a throwaway repository strips the caller's GIT_* variables.
  expect(fixtureRepoTests().length).toBeGreaterThan(0);
  for (const file of fixtureRepoTests())
    expect(readFileSync(join(ROOT, file), "utf8"), file).toContain("withoutGitEnv");
});

test("fixtures_ignore_hook_git_env", { timeout: 60_000 }, () => {
  // A scratch repository stands in for the real one a hook's GIT_DIR names.
  const real = mkdtempSync(join(tmpdir(), "hook-real-"));
  temps.push(real);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", real, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
      env: withoutGitEnv(),
      encoding: "utf8",
    }).trim();
  git("init", "-q", "-b", "mine");
  git("commit", "-q", "--allow-empty", "-m", "base");
  const state = () => ({
    head: git("symbolic-ref", "HEAD"),
    branches: git("branch", "--format=%(refname) %(objectname)"),
    index: git("ls-files", "--stage"),
    objects: git("count-objects", "-v"),
  });
  const before = state();
  const run = spawnSync("npx", ["vitest", "run", ...fixtureRepoTests()], {
    cwd: ROOT,
    env: { ...process.env, GIT_DIR: join(real, ".git"), GIT_INDEX_FILE: join(real, ".git", "index") },
    encoding: "utf8",
  });
  expect(state()).toEqual(before);
  expect(run.status, run.stdout + run.stderr).toBe(0);
});

test("pre_commit_unsets_git_env", () => {
  const hook = readFileSync(join(ROOT, "scripts", "githooks", "pre-commit"), "utf8");
  const unset = hook.indexOf("unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE");
  expect(unset).toBeGreaterThan(-1);
  expect(unset).toBeLessThan(hook.indexOf("npm run --silent guards"));
});
