// P2.26j: a pull request that changes the deploy lock is judged before it merges, not first on the host.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { fixtureGitEnv } from "../guards/git-env.ts";
import { code } from "../guards/workflows.ts";
import { bumpProblems, main } from "./lock-bump.ts";
import type { ImageLock, LockEntry } from "./verify-images.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
/** A history a → b → c on main; `x` is on no branch of it. */
const ORDER = [A, B, C];
const isAncestor = (older: string, newer: string): boolean =>
  ORDER.includes(older) && ORDER.includes(newer) && ORDER.indexOf(older) <= ORDER.indexOf(newer);

const ours = (digest: string, gitCommit: string): LockEntry => ({
  ref: `ghcr.io/undefined6799/unset/web@sha256:${digest.repeat(64)}`,
  origin: "first-party",
  gitCommit,
  verify: "cosign-keyless",
});
const mirror = (digest: string): LockEntry => ({
  ref: `ghcr.io/undefined6799/mirror/newt@sha256:${digest.repeat(64)}`,
  origin: "upstream",
  upstreamSource: `docker.io/fosrl/newt:1.19.0@sha256:${digest.repeat(64)}`,
  verify: "cosign-keyless",
});

describe("lock bump order", () => {
  const judge = (base: ImageLock | null, head: ImageLock, mainTip = C) => bumpProblems(base, head, mainTip, isAncestor);

  test("forward_bump_on_main_passes", () => {
    expect(judge({ web: ours("1", A) }, { web: ours("2", B) })).toEqual([]);
    // A rebuild of the same commit (a re-run publishes another digest) is not a move back.
    expect(judge({ web: ours("1", B) }, { web: ours("2", B) })).toEqual([]);
    // A first entry, and a first lock, have nothing to move back from.
    expect(judge({}, { web: ours("1", A) })).toEqual([]);
    expect(judge(null, { web: ours("1", A) })).toEqual([]);
  });

  test("move_back_to_an_older_commit_fails", () => {
    expect(judge({ web: ours("2", B) }, { web: ours("1", A) })).toEqual([
      `web: gitCommit ${A} is older than the locked ${B}`,
    ]);
  });

  test("commit_not_on_main_fails", () => {
    const x = "d".repeat(40);
    expect(judge({ web: ours("1", A) }, { web: ours("2", x) })).toEqual([`web: gitCommit ${x} is not on main`]);
    // On main, but past the tip this pull request merges into.
    expect(judge({ web: ours("1", A) }, { web: ours("2", C) }, B)).toEqual([`web: gitCommit ${C} is not on main`]);
  });

  test("malformed_commit_fails", () => {
    for (const gitCommit of ["", "abc", A.toUpperCase(), `${A}\n`]) {
      const entry = { ...ours("2", A), gitCommit };
      expect(judge({ web: ours("1", A) }, { web: entry })).toEqual(["web: gitCommit is not a full lowercase commit"]);
    }
    const { gitCommit: _dropped, ...bare } = ours("2", A);
    expect(judge({}, { web: bare })).toEqual(["web: gitCommit is not a full lowercase commit"]);
  });

  test("unchanged_and_upstream_entries_are_not_judged", () => {
    // An entry already on main is not re-judged: a stale commit there is not this pull request's change.
    const stale = ours("1", "d".repeat(40));
    expect(judge({ web: stale, newt: mirror("1") }, { web: stale, newt: mirror("2") })).toEqual([]);
  });

  test("an_entry_that_turns_first_party_is_judged", () => {
    expect(judge({ web: mirror("1") }, { web: ours("2", "d".repeat(40)) })).toHaveLength(1);
  });
});

describe("lock bump cli", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: fixtureGitEnv(), encoding: "utf8" }).trim();

  /** A repository whose main holds three commits; returns their ids and the folder. */
  function repo(): { dir: string; commits: string[] } {
    const dir = mkdtempSync(join(tmpdir(), "lock-bump-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    mkdirSync(join(dir, "deployment"));
    const commits: string[] = [];
    for (const n of [1, 2, 3]) {
      writeFileSync(join(dir, "file"), String(n));
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", `c${n}`);
      commits.push(git(dir, "rev-parse", "HEAD"));
    }
    return { dir, commits };
  }

  /** Runs the CLI over `head` in the working tree; with `committed`, that lock is first committed and becomes the base. */
  function run(dir: string, baseSha: string, head: ImageLock | string, committed?: ImageLock) {
    const env = fixtureGitEnv();
    let base = baseSha;
    if (committed !== undefined) {
      writeFileSync(join(dir, "deployment/images.lock.json"), JSON.stringify(committed));
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "lock");
      base = git(dir, "rev-parse", "HEAD");
    }
    writeFileSync(join(dir, "deployment/images.lock.json"), typeof head === "string" ? head : JSON.stringify(head));
    const output = join(dir, "output");
    writeFileSync(output, "");
    const lines: string[] = [];
    const code = main({ root: dir, env: { ...env, BASE_SHA: base, GITHUB_OUTPUT: output }, log: (l) => lines.push(l) });
    return { code, output: readFileSync(output, "utf8"), lines };
  }

  test("unchanged_lock_passes_and_asks_for_no_verify", () => {
    const { dir, commits } = repo();
    const lock = { web: ours("1", commits[0] ?? "") };
    expect(run(dir, "", lock, lock)).toMatchObject({ code: 0, output: "changed=false\n" });
  });

  test("forward_bump_passes_and_asks_for_verify", () => {
    const { dir, commits } = repo();
    const result = run(dir, "", { web: ours("2", commits[1] ?? "") }, { web: ours("1", commits[0] ?? "") });
    expect(result).toMatchObject({ code: 0, output: "changed=true\n" });
  });

  test("first_lock_passes_and_asks_for_verify", () => {
    const { dir, commits } = repo();
    expect(run(dir, commits[2] ?? "", { web: ours("1", commits[0] ?? "") })).toMatchObject({
      code: 0,
      output: "changed=true\n",
    });
  });

  test("move_back_fails_and_writes_no_verdict", () => {
    const { dir, commits } = repo();
    const result = run(dir, "", { web: ours("1", commits[0] ?? "") }, { web: ours("2", commits[1] ?? "") });
    expect(result.code).toBe(1);
    expect(result.output).toBe("");
    expect(result.lines.join("\n")).toContain("is older than the locked");
  });

  test("unknown_commit_fails", () => {
    const { dir, commits } = repo();
    const result = run(dir, "", { web: ours("2", "d".repeat(40)) }, { web: ours("1", commits[0] ?? "") });
    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("is not on main");
  });

  test("unreadable_inputs_fail_closed", () => {
    const { dir, commits } = repo();
    const good = { web: ours("1", commits[0] ?? "") };
    expect(run(dir, "", "{", good).code).toBe(1);
    expect(run(dir, "", "[]", good).code).toBe(1);
    expect(run(dir, "not-a-sha", good).code).toBe(1);
    expect(run(dir, "e".repeat(40), good).code).toBe(1);
    // No output file: the verdict has nowhere to go. The runner's own GITHUB_OUTPUT must not leak in.
    const env = { ...fixtureGitEnv(), BASE_SHA: commits[2] ?? "", GITHUB_OUTPUT: undefined };
    expect(main({ root: dir, env, log: (line) => void line })).toBe(1);
  });
});

describe("lock workflow", () => {
  const text = readFileSync(join(ROOT, ".github/workflows/lock.yml"), "utf8");
  const publish = readFileSync(join(ROOT, ".github/workflows/publish-images.yml"), "utf8");

  test("verifies_a_changed_lock_offline_with_the_pinned_cosign", () => {
    expect(text).toContain("      - id: bump\n        run: node scripts/ci/lock-bump.ts\n");
    expect(text).toContain(
      "node scripts/ci/verify-images.ts deployment/images.lock.json --trusted-root deployment/sigstore/trusted_root.json",
    );
    // Both later steps run exactly when the first said the lock changed; a failed first step fails the job.
    expect(text.match(/^ {8}if: steps\.bump\.outputs\.changed == 'true'$/gm)).toHaveLength(2);
    expect(text.match(/^\s*if:/gm)).toHaveLength(3);
    expect(text).not.toMatch(/continue-on-error|\|\|\s*true/);
    // The same cosign, by the same checksum, as the job that signs.
    for (const key of ["COSIGN_VERSION", "COSIGN_SHA256"]) {
      const pin = new RegExp(`^ {6}${key}: \\S+$`, "m").exec(publish)?.[0];
      expect(pin, key).toBeDefined();
      expect(text, key).toContain(pin);
    }
  });

  test("holds_no_write_scope_secret_or_environment", () => {
    expect(text).toContain("\npermissions: {}\n");
    expect(text.match(/^ {4}permissions:\n {6}contents: read\n(?! {6})/gm)).toHaveLength(1);
    expect(code(text).join("\n")).not.toMatch(/\bwrite\b|\bsecrets\b|environment|id-token|packages/);
  });
});
