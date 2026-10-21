import { expect, test } from "vitest";
import {
  type AutoMergeFacts,
  decide,
  type MergeClient,
  type PullSnapshot,
  parsePrNumbers,
  runAutoMerge,
} from "./docs-auto-merge.ts";
import type { ChangedPath } from "./docs-only-paths.ts";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

const ok: AutoMergeFacts = {
  sameRepo: true,
  draft: false,
  labels: ["kind/docs"],
  paths: [{ path: "docs/human/architecture.md" }],
  pathsError: false,
  check: "success",
  autoMerge: "off",
};

test("enables_only_when_every_gate_holds", () => {
  expect(decide(ok)).toBe("enable");
  expect(decide({ ...ok, autoMerge: "squash" })).toBe("leave");
  expect(decide({ ...ok, autoMerge: "other" })).toBe("enable");
  expect(decide({ ...ok, sameRepo: false })).toBe("leave");
  expect(decide({ ...ok, sameRepo: false, autoMerge: "squash" })).toBe("disable");
  expect(decide({ ...ok, labels: [] })).toBe("leave");
  expect(decide({ ...ok, labels: ["kind/build"], autoMerge: "squash" })).toBe("disable");
  expect(decide({ ...ok, draft: true, autoMerge: "squash" })).toBe("disable");
  expect(decide({ ...ok, check: "failure" })).toBe("leave");
  expect(decide({ ...ok, check: "skipped" })).toBe("leave");
  expect(decide({ ...ok, check: "pending", autoMerge: "squash" })).toBe("disable");
  expect(decide({ ...ok, check: "missing" })).toBe("leave");
  expect(decide({ ...ok, check: "error", autoMerge: "off" })).toBe("leave");
  expect(decide({ ...ok, paths: [{ path: "CLAUDE.md" }], autoMerge: "squash" })).toBe("disable");
  expect(decide({ ...ok, paths: [] })).toBe("leave");
  expect(decide({ ...ok, pathsError: true, autoMerge: "off" })).toBe("leave");
  expect(decide({ ...ok, pathsError: true, autoMerge: "squash" })).toBe("disable");
  expect(decide({ ...ok, autoMerge: "unknown" })).toBe("disable");
  expect(decide({ ...ok, paths: [{ path: "docs/human/b.md", previous: "package.json" }], autoMerge: "squash" })).toBe(
    "disable",
  );
});

test("pull_request_numbers_fail_closed", () => {
  expect(parsePrNumbers(undefined)).toEqual([]);
  expect(parsePrNumbers("null")).toEqual([]);
  expect(parsePrNumbers("[3, 3]")).toEqual([3]);
  expect(() => parsePrNumbers("{}")).toThrow(/not a list/);
  expect(() => parsePrNumbers("[0]")).toThrow(/number/);
  expect(() => parsePrNumbers("nope")).toThrow();
});

function client(
  pull: PullSnapshot,
  files: readonly ChangedPath[],
): { github: MergeClient; enabled: string[]; disabled: string[] } {
  const enabled: string[] = [];
  const disabled: string[] = [];
  const github: MergeClient = {
    pullsForCommit: async () => [pull.number],
    pull: async () => pull,
    files: async () => files,
    check: async () => "success",
    enable: async (id, sha) => {
      enabled.push(`${id}:${sha}`);
    },
    disable: async (id) => {
      disabled.push(id);
    },
  };
  return { github, enabled, disabled };
}

const pull: PullSnapshot = {
  number: 7,
  nodeId: "PR_7",
  state: "open",
  draft: false,
  headSha: SHA,
  headRepo: "Undefined6799/unset",
  labels: ["kind/docs"],
  autoMerge: "off",
};

const env = {
  REPO: "Undefined6799/unset",
  HEAD_SHA: SHA,
  HEAD_REPO: "Undefined6799/unset",
  WORKFLOW_PATH: ".github/workflows/docs-only.yml",
  WORKFLOW_EVENT: "pull_request",
  PR_NUMBERS: "[7]",
};

test("run_enables_squash_for_a_same_repo_docs_pull_request", async () => {
  const { github, enabled, disabled } = client(pull, [{ path: "README.md" }]);
  expect(await runAutoMerge(env, github)).toBe(0);
  expect(enabled).toEqual([`PR_7:${SHA}`]);
  expect(disabled).toEqual([]);
});

test("run_refuses_a_fork_and_a_moved_head", async () => {
  const fork = client({ ...pull, headRepo: "someone/unset" }, [{ path: "README.md" }]);
  expect(await runAutoMerge({ ...env, HEAD_REPO: "someone/unset", PR_NUMBERS: "[]" }, fork.github)).toBe(0);
  expect(fork.enabled).toEqual([]);
  const moved = client({ ...pull, headSha: OTHER }, [{ path: "README.md" }]);
  expect(await runAutoMerge(env, moved.github)).toBe(0);
  expect(moved.enabled).toEqual([]);
});

test("run_disables_when_the_file_list_fails", async () => {
  const github: MergeClient = {
    pullsForCommit: async () => [7],
    pull: async () => ({ ...pull, autoMerge: "squash" }),
    files: async () => {
      throw new Error("github 500 /pulls/7/files");
    },
    check: async () => "success",
    enable: async () => {
      throw new Error("should not enable");
    },
    disable: async () => undefined,
  };
  expect(await runAutoMerge(env, github)).toBe(1);
});

test("run_ignores_other_workflows_and_rejects_two_pull_requests", async () => {
  const { github, enabled } = client(pull, [{ path: "README.md" }]);
  expect(await runAutoMerge({ ...env, WORKFLOW_EVENT: "push" }, github)).toBe(0);
  expect(enabled).toEqual([]);
  expect(await runAutoMerge({ ...env, PR_NUMBERS: "[7, 8]" }, github)).toBe(1);
  expect(await runAutoMerge({ ...env, HEAD_SHA: "nope" }, github)).toBe(1);
});
