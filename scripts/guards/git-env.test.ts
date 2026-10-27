// P0.09j: guard fixtures never touch the repository a caller's GIT_* variables point at. Git exports GIT_DIR,
// GIT_WORK_TREE and the like to hooks "so that Git commands run by the hook can correctly locate the repository"
// (githooks(5), git v2.43.0 Documentation/githooks.txt:30-35), and the pre-commit hook runs these tests.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { parseSync } from "vite";
import { afterAll, describe, expect, test } from "vitest";
import { fixtureGitEnv, withoutGitEnv } from "./git-env.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Check-folder files that build throwaway repositories with `git init`, the helper and its test aside. */
function fixtureRepoFiles(): string[] {
  return ["scripts/guards", "scripts/ci"].flatMap((dir) =>
    (readdirSync(join(ROOT, dir), { encoding: "utf8", recursive: true }) as string[])
      .map((rel) => `${dir}/${rel.split(sep).join("/")}`)
      .filter((file) => file.endsWith(".ts") && !/\/(fixtures|node_modules)\//.test(file))
      .filter((file) => !file.endsWith("/git-env.ts") && !file.endsWith("/git-env.test.ts"))
      .filter((file) => /"init"/.test(readFileSync(join(ROOT, file), "utf8"))),
  );
}

/** The guard test files that build throwaway repositories with `git init`. */
const fixtureRepoTests = (): string[] =>
  readdirSync(join(ROOT, "scripts", "guards"))
    .filter((f) => f.endsWith(".test.ts") && f !== "git-env.test.ts")
    .filter((f) => /"init"/.test(readFileSync(join(ROOT, "scripts", "guards", f), "utf8")))
    .map((f) => `scripts/guards/${f}`);

// P1.23h: the presence rule reads each call, not the text. The file is parsed with oxc through vite's parseSync
// (vite 8.3.4, node_modules/vite/dist/node/index.d.ts re-exports rolldown/utils' parseSync), as
// scripts/budgets/count-glue-lines.ts and shared/ui-build/jsx-free.test.ts already do; TypeScript 7.0.2 ships no
// JavaScript API. Every execFileSync, execFile, spawn or spawnSync of the literal "git", called by name or as a
// member, must pass an options object literal whose `env` is fixtureGitEnv(...) or an object that spreads it, and
// fixtureGitEnv must be the one imported from git-env.ts. Options the rule cannot read fail closed.
type Node = { type: string; start: number; [key: string]: unknown };
const SPAWNS = new Set(["execFileSync", "execFile", "spawn", "spawnSync"]);
const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression"]);

function* nodes(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {
    for (const child of value) yield* nodes(child);
  } else if (value !== null && typeof value === "object") {
    const node = value as Node;
    if (typeof node.type === "string") yield node;
    for (const [key, child] of Object.entries(node)) if (key !== "parent") yield* nodes(child);
  }
}

const unwrap = (node: Node | undefined): Node | undefined =>
  node !== undefined && WRAPPERS.has(node.type) ? unwrap(node.expression as Node) : node;

const named = (node: Node | undefined, name: string): boolean => node?.type === "Identifier" && node.name === name;

function isString(node: Node | undefined, value: string): boolean {
  if (node?.type === "Literal") return node.value === value;
  if (node?.type !== "TemplateLiteral" || (node.expressions as unknown[]).length > 0) return false;
  return (node.quasis as { value: { cooked: string } }[])[0]?.value.cooked === value;
}

function spawnName(callee: Node): string | undefined {
  if (callee.type === "Identifier") return callee.name as string;
  const property = callee.property as Node | undefined;
  if (callee.type === "MemberExpression" && callee.computed !== true && property?.type === "Identifier") {
    return property.name as string;
  }
  return undefined;
}

const isHelperCall = (node: Node | undefined): boolean =>
  node?.type === "CallExpression" && named(node.callee as Node, "fixtureGitEnv");

/** True when `options` is an object literal whose `env` is fixtureGitEnv(...) or spreads it. */
function sealedOptions(options: Node | undefined): boolean {
  if (options?.type !== "ObjectExpression") return false;
  const env = (options.properties as Node[]).find(
    (p) =>
      p.type === "Property" && p.computed !== true && (named(p.key as Node, "env") || isString(p.key as Node, "env")),
  );
  const value = unwrap(env?.value as Node | undefined);
  if (isHelperCall(value)) return true;
  if (value?.type !== "ObjectExpression") return false;
  return (value.properties as Node[]).some(
    (p) => p.type === "SpreadElement" && isHelperCall(unwrap(p.argument as Node)),
  );
}

/** Why `text`, a file that makes a throwaway repository, may let the caller's git env or config in. Empty means fine. */
function fixtureGitProblems(file: string, text: string): string[] {
  const { program, errors } = parseSync(file, text, { lang: "ts", sourceType: "module" });
  if (errors.length > 0) return [`${file}: does not parse: ${errors[0]?.message}`];
  const all = [...nodes(program)];
  const lineOf = (node: Node) => text.slice(0, node.start).split("\n").length;
  const calls = all.filter((node) => {
    if (node.type !== "CallExpression") return false;
    const name = spawnName(node.callee as Node);
    return name !== undefined && SPAWNS.has(name) && isString(unwrap((node.arguments as Node[])[0]), "git");
  });
  if (calls.length === 0) return [`${file}: makes no git call the rule can read`];
  const problems: string[] = [];
  for (const call of calls) {
    const args = (call.arguments as Node[]).map((arg) => unwrap(arg));
    const options = args[1]?.type === "ObjectExpression" ? args[1] : args[2];
    if (!sealedOptions(options)) problems.push(`${file}:${lineOf(call)}: git call without a fixtureGitEnv() env`);
  }
  const imported = all.some(
    (node) =>
      node.type === "ImportDeclaration" &&
      /(^|\/)git-env\.ts$/.test(String((node.source as Node).value)) &&
      (node.specifiers as Node[]).some(
        (s) => named(s.imported as Node, "fixtureGitEnv") && named(s.local as Node, "fixtureGitEnv"),
      ),
  );
  if (problems.length === 0 && !imported) problems.push(`${file}: fixtureGitEnv is not imported from git-env.ts`);
  return problems;
}

test("fixture_helper_strips_git_env", () => {
  const env = { PATH: "/bin", GIT_DIR: "/r/.git", GIT_INDEX_FILE: "/r/.git/index", GIT_WORK_TREE: "/r", HOME: "/h" };
  expect(withoutGitEnv(env)).toEqual({ PATH: "/bin", HOME: "/h" });
  // Every file that makes a throwaway repository strips the caller's GIT_* variables and git config (P1.23g), in
  // scripts/guards and, since P1.23h, scripts/ci (secrets-fixtures.ts commits in throwaway repositories).
  const files = fixtureRepoFiles();
  expect(files).toContain("scripts/ci/secrets-fixtures.ts");
  for (const file of files) {
    expect(fixtureGitProblems(file, readFileSync(join(ROOT, file), "utf8"))).toEqual([]);
  }
});

describe("the presence rule checks each git call (P1.23h)", () => {
  const head = 'import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";\n';
  const sealed = 'import { fixtureGitEnv, withoutGitEnv } from "./git-env.ts";\n';

  test("presence_rule_passes_sealed_calls", () => {
    const good = [
      head,
      sealed,
      'const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { env: fixtureGitEnv() });\n',
      'spawnSync("git", ["init", "-q"], { cwd: dir, env: { ...fixtureGitEnv(), EXTRA: "1" } });\n',
      'spawnSync("docker", ["run"], { env: withoutGitEnv() });\n',
    ].join("");
    expect(fixtureGitProblems("good.ts", good)).toEqual([]);
  });

  test("presence_rule_refuses_an_import_with_no_use", () => {
    const text = `${head}${sealed}execFileSync("git", ["init", "-q"], { cwd: dir, env: process.env });\n`;
    expect(fixtureGitProblems("unused.ts", text)).toEqual(["unused.ts:3: git call without a fixtureGitEnv() env"]);
    // A spread of something else is not the helper either.
    const spread = `${head}${sealed}spawnSync("git", ["init"], { env: { ...process.env, ...withoutGitEnv() } });\n`;
    expect(fixtureGitProblems("spread.ts", spread)).toEqual(["spread.ts:3: git call without a fixtureGitEnv() env"]);
  });

  test("presence_rule_refuses_a_spawn_with_without_git_env", () => {
    const text = `${head}${sealed}execFileSync("git", ["init"], { env: fixtureGitEnv() });\nspawnSync("git", ["commit"], { env: withoutGitEnv() });\n`;
    expect(fixtureGitProblems("without.ts", text)).toEqual(["without.ts:4: git call without a fixtureGitEnv() env"]);
  });

  test("presence_rule_refuses_a_spawn_with_no_env", () => {
    const text = `${head}${sealed}execFileSync("git", ["init"], { env: fixtureGitEnv() });\nspawn("git", ["add", "-A"], { cwd: dir });\n`;
    expect(fixtureGitProblems("noenv.ts", text)).toEqual(["noenv.ts:4: git call without a fixtureGitEnv() env"]);
  });

  test("presence_rule_refuses_options_it_cannot_read", () => {
    const viaName = `${head}${sealed}const opts = { env: fixtureGitEnv() };\nexecFile("git", ["init"], opts);\n`;
    expect(fixtureGitProblems("name.ts", viaName)).toEqual(["name.ts:4: git call without a fixtureGitEnv() env"]);
    const member = `import * as cp from "node:child_process";\n${sealed}cp.spawnSync("git", ["init"]);\n`;
    expect(fixtureGitProblems("member.ts", member)).toEqual(["member.ts:3: git call without a fixtureGitEnv() env"]);
    // A local fixtureGitEnv is not the helper: the name must be imported from git-env.ts.
    const local = `${head}const fixtureGitEnv = () => process.env;\nexecFileSync("git", ["init"], { env: fixtureGitEnv() });\n`;
    expect(fixtureGitProblems("local.ts", local)).toEqual(["local.ts: fixtureGitEnv is not imported from git-env.ts"]);
    expect(fixtureGitProblems("broken.ts", "execFileSync(")[0]).toMatch(/^broken\.ts: does not parse/);
  });
});

/** A home whose git config dir holds `file` with `text`, as XDG_CONFIG_HOME and as the ~/.config fallback. */
function homes(file: string, text: string): NodeJS.ProcessEnv[] {
  const home = mkdtempSync(join(tmpdir(), "fixture-home-"));
  temps.push(home);
  mkdirSync(join(home, "xdg", "git"), { recursive: true });
  mkdirSync(join(home, ".config", "git"), { recursive: true });
  writeFileSync(join(home, "xdg", "git", file), text);
  writeFileSync(join(home, ".config", "git", file), text);
  const { XDG_CONFIG_HOME: _drop, ...rest } = process.env;
  return [
    { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "xdg") },
    { ...rest, HOME: home },
  ];
}

function fixtureRepo(caller: NodeJS.ProcessEnv): (...args: string[]) => string {
  const repo = mkdtempSync(join(tmpdir(), "fixture-repo-"));
  temps.push(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { env: fixtureGitEnv(caller), encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.secret"), "token\n");
  return git;
}

test("fixture_git_ignores_xdg_excludes", () => {
  // A home ignore file that hides *.secret would make a secrets-scanner fixture pass for the wrong reason.
  for (const caller of homes("ignore", "*.secret\n")) {
    const git = fixtureRepo(caller);
    git("add", "-A");
    expect(git("ls-files")).toBe("a.secret");
  }
});

test("fixture_git_ignores_xdg_attributes", () => {
  for (const caller of homes("attributes", "*.secret -text -diff filter=boom\n")) {
    const git = fixtureRepo(caller);
    expect(git("check-attr", "--all", "a.secret")).toBe("");
  }
});

test("fixture_git_ignores_system_config", () => {
  // GIT_CONFIG_SYSTEM at a config that signs with a failing signer: without the helper the commit fails.
  const dir = mkdtempSync(join(tmpdir(), "fixture-system-"));
  temps.push(dir);
  const system = join(dir, "gitconfig");
  writeFileSync(system, "[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n");
  const caller = { ...process.env, GIT_CONFIG_SYSTEM: system };
  const git = fixtureRepo(caller);
  const identity = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t" };
  const bare = { ...caller, ...identity, GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null" };
  const repo = git("rev-parse", "--show-toplevel");
  const signed = spawnSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "x"], {
    env: bare,
    encoding: "utf8",
  });
  expect(signed.stderr).toMatch(/gpg failed to sign/);
  git("commit", "-q", "--allow-empty", "-m", "fixture");
  expect(git("rev-list", "--count", "HEAD")).toBe("1");
});

test("fixture_git_sets_its_config_count_fresh", () => {
  const caller = {
    PATH: "/bin",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_2: "core.excludesFile",
    GIT_CONFIG_VALUE_2: "/home/me/ignore",
    GIT_CONFIG_PARAMETERS: "'core.excludesfile'='/home/me/ignore'",
  };
  const env = fixtureGitEnv(caller);
  expect(Object.entries(env).filter(([name]) => name.startsWith("GIT_CONFIG"))).toEqual([
    ["GIT_CONFIG_GLOBAL", "/dev/null"],
    ["GIT_CONFIG_NOSYSTEM", "1"],
    ["GIT_CONFIG_COUNT", "2"],
    ["GIT_CONFIG_KEY_0", "core.excludesFile"],
    ["GIT_CONFIG_VALUE_0", "/dev/null"],
    ["GIT_CONFIG_KEY_1", "core.attributesFile"],
    ["GIT_CONFIG_VALUE_1", "/dev/null"],
  ]);
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
