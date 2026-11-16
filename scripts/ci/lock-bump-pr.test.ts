// P2.26m: after signing, a job with no signing right opens the bump pull request from the verified lock.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkCommitMessage, checkPrTitle } from "../guards/commit-msg.ts";
import { checkPrTemplate } from "../guards/pr-template.ts";
import {
  type BumpClient,
  type BumpEnv,
  bumpBody,
  bumpTitle,
  LOCK_CHECK,
  requiredContexts,
  runBump,
} from "./lock-bump-pr.ts";
import { COMPOSE_PATH, LOCK_PATH } from "./lock-write.ts";
import type { ImageLock } from "./verify-images.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const TEMPLATE_PATH = ".github/pull_request_template.md";
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const COMMIT = "b".repeat(40);

/** The committed lock's first-party entries, re-published at COMMIT with new digests. */
function published(digit = "7"): string {
  const lock = JSON.parse(read(LOCK_PATH)) as ImageLock;
  const entries = Object.entries(lock)
    .filter(([, entry]) => entry.origin === "first-party")
    .map(([name, entry]) => [
      name,
      { ...entry, ref: `${entry.ref.split("@")[0]}@sha256:${digit.repeat(64)}`, gitCommit: COMMIT },
    ]);
  return JSON.stringify(Object.fromEntries(entries));
}

type Call = { op: string; args: unknown[] };
function fakeGithub(failAt?: string, required = ["check", LOCK_CHECK]): { github: BumpClient; calls: Call[] } {
  const calls: Call[] = [];
  const record =
    <T>(op: string, result: T) =>
    async (...args: unknown[]): Promise<T> => {
      calls.push({ op, args });
      if (op === failAt) throw new Error(`github 422 ${op}`);
      return result;
    };
  const github: BumpClient = {
    treeOf: record("treeOf", "tree-0"),
    createTree: record("createTree", "tree-1"),
    createCommit: record("createCommit", "commit-1"),
    createBranch: record("createBranch", undefined),
    openPull: record("openPull", { number: 77, nodeId: "PR_node" }),
    requiredChecks: record("requiredChecks", required),
    enableAutoMerge: record("enableAutoMerge", undefined),
  };
  return { github, calls };
}

const ENV: BumpEnv = { REPO: "Undefined6799/unset", COMMIT, RUN_ATTEMPT: "1", PUBLISHED_LOCK: published() };
async function run(env: BumpEnv, failAt?: string, required?: string[]) {
  const { github, calls } = fakeGithub(failAt, required);
  const lines: string[] = [];
  const code = await runBump({ env, github, readText: read, log: (line) => lines.push(line) });
  return { code, calls, lines };
}

const OPEN = ["treeOf", "createTree", "createCommit", "createBranch", "openPull"];

describe("lock bump pull request", () => {
  test("opens_one_pull_request_with_both_files_off_the_published_commit", async () => {
    const { code, calls, lines } = await run(ENV);
    expect(code).toBe(0);
    expect(calls.map((call) => call.op)).toEqual([...OPEN, "requiredChecks", "enableAutoMerge"]);
    expect(calls[0]?.args).toEqual([COMMIT]);
    const [baseTree, files] = (calls[1]?.args ?? []) as [string, { path: string; content: string }[]];
    expect(baseTree).toBe("tree-0");
    expect(files.map((file) => file.path)).toEqual([LOCK_PATH, COMPOSE_PATH]);
    const digest = `@sha256:${"7".repeat(64)}`;
    expect(files[0]?.content.split(digest).length).toBeGreaterThan(2);
    expect(files[1]?.content).toContain(digest);
    // One commit whose only parent is the published commit, on a branch that is never main.
    const [message, tree, parent] = (calls[2]?.args ?? []) as [string, string, string];
    expect([tree, parent]).toEqual(["tree-1", COMMIT]);
    expect(checkCommitMessage(message)).toEqual({ ok: true });
    expect(calls[3]?.args).toEqual([`lock-bump/${COMMIT.slice(0, 12)}-1`, "commit-1"]);
    const pull = calls[4]?.args[0] as { title: string; head: string; body: string };
    expect(pull.head).toBe(`lock-bump/${COMMIT.slice(0, 12)}-1`);
    expect(pull.title).toBe(message.split("\n")[0]);
    expect(lines.join("\n")).toContain("opened #77");
  });

  test("title_and_body_pass_pr_shape", () => {
    expect(checkPrTitle(bumpTitle(COMMIT))).toEqual({ ok: true });
    const body = bumpBody(read(TEMPLATE_PATH), COMMIT);
    expect(checkPrTemplate(body, read(TEMPLATE_PATH))).toEqual([]);
    expect(body).toContain(COMMIT);
    expect(body).toContain("AI notes: none needed");
  });

  test("an_unchanged_lock_opens_nothing", async () => {
    const lock = JSON.parse(read(LOCK_PATH)) as ImageLock;
    const first = Object.entries(lock).filter(([, entry]) => entry.origin === "first-party");
    const commit = first[0]?.[1].gitCommit ?? "";
    const same = JSON.stringify(Object.fromEntries(first));
    const { code, calls } = await run({ ...ENV, COMMIT: commit, PUBLISHED_LOCK: same });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
  });

  test("bad_input_fails_before_any_write", async () => {
    const bad: BumpEnv[] = [
      { ...ENV, COMMIT: "main" },
      { ...ENV, REPO: "evil/../x y" },
      { ...ENV, RUN_ATTEMPT: "1; rm" },
      { ...ENV, RUN_ATTEMPT: "0" },
      { ...ENV, PUBLISHED_LOCK: "" },
      { ...ENV, PUBLISHED_LOCK: "{" },
      { ...ENV, PUBLISHED_LOCK: "{}" },
      // Another commit's lock: lock-write refuses it.
      { ...ENV, COMMIT: "c".repeat(40) },
      { ...ENV, PUBLISHED_LOCK: published().replaceAll("undefined6799/unset/", "evil/unset/") },
    ];
    for (const env of bad) {
      const { code, calls } = await run(env);
      expect(code, JSON.stringify(env).slice(0, 120)).toBe(1);
      expect(calls).toEqual([]);
    }
  });

  test("a_github_error_fails_the_run", async () => {
    for (const op of ["treeOf", "createTree", "createCommit", "createBranch", "openPull"]) {
      const { code, lines } = await run(ENV, op);
      expect(code, op).toBe(1);
      expect(lines.at(-1)).toBe(`lock-bump-pr: github 422 ${op}`);
    }
  });

  // P2.26n, ADR 0047: the bump merges itself only behind a required `lock` check, and only at the commit just made.
  test("auto_merge_is_pinned_to_the_commit_it_made", async () => {
    const { code, calls, lines } = await run(ENV);
    expect(code).toBe(0);
    expect(calls.at(-1)).toEqual({ op: "enableAutoMerge", args: ["PR_node", "commit-1"] });
    expect(lines.at(-1)).toContain("merges itself");
  });

  test("no_auto_merge_unless_the_lock_check_is_required", async () => {
    for (const required of [
      [],
      ["check", "audit", "secrets", "actionlint", "semgrep", "pr-shape"],
      ["Lock", "lock "],
    ]) {
      const { code, calls, lines } = await run(ENV, undefined, required);
      expect(code).toBe(0);
      expect(calls.map((call) => call.op)).toEqual([...OPEN, "requiredChecks"]);
      expect(lines.at(-1)).toContain("not a required check");
    }
  });

  test("auto_merge_failures_fail_the_job_and_never_retry_open", async () => {
    // The rules cannot be read: nothing is enabled. The pull request stays open for a person.
    const unread = await run(ENV, "requiredChecks");
    expect(unread.code).toBe(1);
    expect(unread.calls.map((call) => call.op)).toEqual([...OPEN, "requiredChecks"]);
    const refused = await run(ENV, "enableAutoMerge");
    expect(refused.code).toBe(1);
    expect(refused.calls.filter((call) => call.op === "openPull")).toHaveLength(1);
  });

  test("required_checks_are_read_from_the_branch_rules", () => {
    // The shape `GET /repos/{repo}/rules/branches/main` answered for this repository on 2026-11-15.
    const checks = [{ context: "check", integration_id: 15368 }, { context: LOCK_CHECK }];
    const rules = [
      { type: "deletion", ruleset_id: 1 },
      { type: "required_status_checks", parameters: { required_status_checks: checks } },
    ];
    expect(requiredContexts(rules)).toEqual(["check", LOCK_CHECK]);
    expect(requiredContexts([{ type: "deletion" }])).toEqual([]);
    // Anything unreadable throws, and a throw enables nothing.
    for (const bad of [null, {}, "lock", [{ type: "required_status_checks" }]]) {
      expect(() => requiredContexts(bad), JSON.stringify(bad)).toThrow();
    }
    const nameless = [{ type: "required_status_checks", parameters: { required_status_checks: [{ id: 1 }] } }];
    expect(() => requiredContexts(nameless)).toThrow();
  });
});
