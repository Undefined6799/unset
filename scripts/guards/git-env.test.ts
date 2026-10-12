// P0.09j: guard fixtures never touch the repository a caller's GIT_* variables point at. Git exports GIT_DIR,
// GIT_WORK_TREE and the like to hooks "so that Git commands run by the hook can correctly locate the repository"
// (githooks(5), git v2.43.0 Documentation/githooks.txt:30-35), and the pre-commit hook runs these tests.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { fixtureGitEnv, withoutGitEnv } from "./git-env.ts";

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
  // Every test file that makes a throwaway repository strips the caller's GIT_* variables and git config (P1.23g).
  expect(fixtureRepoTests().length).toBeGreaterThan(0);
  for (const file of fixtureRepoTests()) {
    const text = readFileSync(join(ROOT, file), "utf8");
    expect(text, file).toContain("fixtureGitEnv");
    expect(text, file).not.toMatch(/withoutGitEnv\(\)/);
  }
});

test("fixture_git_ignores_global_config", () => {
  // P1.23g: a developer's or agent's ~/.gitconfig that signs every commit, here with a signer that always fails.
  const home = mkdtempSync(join(tmpdir(), "fixture-home-"));
  const repo = mkdtempSync(join(tmpdir(), "fixture-repo-"));
  temps.push(home, repo);
  writeFileSync(join(home, ".gitconfig"), "[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n");
  const commit = (env: NodeJS.ProcessEnv) =>
    spawnSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "fixture"], { env, encoding: "utf8" });
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"], { env: fixtureGitEnv() });
  const caller = { ...process.env, HOME: home };
  // Without the helper the global config signs the same commit, and the signer fails it; with it, no config is read.
  const identity = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t" };
  const signed = commit({ ...withoutGitEnv(caller), ...identity, GIT_COMMITTER_EMAIL: "t@example.invalid" });
  expect(signed.stderr).toMatch(/gpg failed to sign/);
  const run = commit(fixtureGitEnv(caller));
  expect(run.status, run.stderr).toBe(0);
});

test("fixtures_ignore_hook_git_env", { timeout: 60_000 }, () => {
  // A scratch repository stands in for the real one a hook's GIT_DIR names.
  const real = mkdtempSync(join(tmpdir(), "hook-real-"));
  temps.push(real);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", real, ...args], {
      env: fixtureGitEnv(),
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
