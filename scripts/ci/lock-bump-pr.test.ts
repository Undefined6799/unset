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
const MAIN = "a".repeat(40);

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
type Fake = {
  failAt?: string | undefined;
  required?: string[] | undefined;
  order?: string;
  files?: (path: string) => string;
};
function fakeGithub({ failAt, required = ["check", LOCK_CHECK], order = "ahead", files = read }: Fake): {
  github: BumpClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const record =
    <T>(op: string, result: T) =>
    async (...args: unknown[]): Promise<T> => {
      calls.push({ op, args });
      if (op === failAt) throw new Error(`github 422 ${op}`);
      return result;
    };
  const github: BumpClient = {
    mainHead: record("mainHead", MAIN),
    fileAt: async (commit, path) => {
      calls.push({ op: "fileAt", args: [commit, path] });
      if (failAt === "fileAt") throw new Error("github 422 fileAt");
      return files(path);
    },
    order: record("order", order),
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
async function run(env: BumpEnv, failAt?: string, required?: string[], fake: Fake = {}) {
  const { github, calls } = fakeGithub({ ...fake, failAt, required });
  const lines: string[] = [];
  const code = await runBump({ env, github, readText: read, log: (line) => lines.push(line) });
  // The reads of main come first on every run; `calls` is what follows them, `reads` is them.
  const isRead = (call: Call) => READS.includes(call.op);
  return { code, calls: calls.filter((call) => !isRead(call)), reads: calls.filter(isRead), lines };
}

const READS = ["mainHead", "fileAt", "order"];
const OPEN = ["treeOf", "createTree", "createCommit", "createBranch", "openPull"];
/** The commit the committed lock's first-party entries name. */
const LOCKED = Object.values(JSON.parse(read(LOCK_PATH)) as ImageLock).find((entry) => entry.origin === "first-party")
  ?.gitCommit as string;

describe("lock bump pull request", () => {
  test("opens_one_pull_request_with_both_files_off_main", async () => {
    const { code, calls, reads, lines } = await run(ENV);
    expect(code).toBe(0);
    expect(calls.map((call) => call.op)).toEqual([...OPEN, "requiredChecks", "enableAutoMerge"]);
    // Both files are read at main's head, and the published commit must be ahead of the locked one.
    expect(reads).toEqual([
      { op: "mainHead", args: [] },
      { op: "fileAt", args: [MAIN, LOCK_PATH] },
      { op: "fileAt", args: [MAIN, COMPOSE_PATH] },
      { op: "order", args: [LOCKED, COMMIT] },
    ]);
    expect(calls[0]?.args).toEqual([MAIN]);
    const [baseTree, files] = (calls[1]?.args ?? []) as [string, { path: string; content: string }[]];
    expect(baseTree).toBe("tree-0");
    expect(files.map((file) => file.path)).toEqual([LOCK_PATH, COMPOSE_PATH]);
    const digest = `@sha256:${"7".repeat(64)}`;
    expect(files[0]?.content.split(digest).length).toBeGreaterThan(2);
    expect(files[1]?.content).toContain(digest);
    // One commit whose only parent is main's head, on a branch that is never main.
    const [message, tree, parent] = (calls[2]?.args ?? []) as [string, string, string];
    expect([tree, parent]).toEqual(["tree-1", MAIN]);
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

  // Two publish runs close together (#1618, #1622): the second bump is written onto what main holds by then.
  test("the_bump_is_written_onto_mains_files_not_the_checkouts", async () => {
    const earlier = "9".repeat(64);
    const digests = /(undefined6799\/unset\/[a-z-]+@sha256:)[0-9a-f]{64}/g;
    const moved = (path: string) =>
      read(path).replaceAll(digests, `$1${earlier}`) + (path === COMPOSE_PATH ? "# only on main\n" : "");
    const { code, calls } = await run(ENV, undefined, undefined, { files: moved });
    expect(code).toBe(0);
    const files = calls[1]?.args[1] as { path: string; content: string }[];
    for (const file of files) {
      expect(file.content).toContain(`@sha256:${"7".repeat(64)}`);
      expect(file.content).not.toContain(earlier);
    }
    expect(files[1]?.content.endsWith("# only on main\n")).toBe(true);
  });

  test("a_lock_that_is_already_as_new_opens_nothing", async () => {
    for (const order of ["identical", "behind"]) {
      const { code, calls, lines } = await run(ENV, undefined, undefined, { order });
      expect(code, order).toBe(0);
      expect(calls).toEqual([]);
      expect(lines.at(-1)).toContain("no pull request");
    }
  });

  test("an_unreadable_order_fails_before_any_write", async () => {
    for (const order of ["diverged", "", "Ahead"]) {
      const { code, calls } = await run(ENV, undefined, undefined, { order });
      expect(code, order).toBe(1);
      expect(calls).toEqual([]);
    }
    for (const op of READS) {
      const { code, calls } = await run(ENV, op);
      expect(code, op).toBe(1);
      expect(calls).toEqual([]);
    }
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
