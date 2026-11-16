// Opens the lock-bump pull request after a publish run (P2.26m). publish-images.yml's `bump` job runs this file, and
// nothing else, from the checkout of the commit that was just published. The job holds `contents: write` and
// `pull-requests: write` and no signing right; the signing job holds neither of those two.
//
// Input: PUBLISHED_LOCK, the lock the publish job wrote and verified in the same run, as a job output. lock-write.ts
// refuses anything that is not that run's shape and writes the two files; this file commits them on a new branch off
// the published commit and opens the pull request. It never pushes to main and never merges directly. The pull
// request is judged like any other bump: lock.yml (P2.26j) verifies every entry's signature and provenance and
// refuses a move back, and pr-shape reads the title, commit and body written here.
//
// Auto-merge (P2.26n, ADR 0047). When main's rules require the `lock` check, this file then turns on GitHub's squash
// auto-merge for the pull request, pinned to the commit it just made; GitHub merges once every required check has
// passed. When `lock` is not required, nothing is turned on and a person merges: without that requirement the merge
// would not wait for the signature check. "Get rules for a branch" returns "all active rules that apply to the
// specified branch" (docs.github.com/en/rest/repos/rules; a required_status_checks rule lists
// `parameters.required_status_checks[].context`). Auto-merge "merges a pull request automatically after all required
// reviews and status checks pass" (docs.github.com/en/pull-requests/collaborating-with-pull-requests/
// incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request). enablePullRequestAutoMerge's
// mergeMethod defaults to MERGE, so SQUASH is passed, with expectedHeadOid, as scripts/guards/docs-auto-merge.ts does.
//
// GitHub REST, version 2026-03-10 (docs.github.com/en/rest/git/trees, /git/commits, /git/refs, /pulls/pulls): a tree
// made with `base_tree` and inline `content` entries, a commit with one parent, a ref `refs/heads/<branch>`, then
// `POST /pulls`. All four need only the token's contents and pull-requests writes
// (docs.github.com/en/rest/authentication/permissions-required-for-github-apps). Opening the pull request also needs
// the repository setting "Allow GitHub Actions to create and approve pull requests".
//
// The pull request's checks do not start by themselves. For a pull request a workflow creates with GITHUB_TOKEN,
// `pull_request` events of type opened, synchronize or reopened "create workflow runs that require approval. A user
// with write access to the repository can approve these runs from the pull request page"
// (docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows, pull_request;
// docs.github.com/en/actions/concepts/security/github_token: "Approve workflows to run" in the merge box). Other
// GITHUB_TOKEN events create no runs at all. Read 2026-11-15; unverified until the first run on main.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bumpedFiles, COMPOSE_PATH, LOCK_PATH } from "./lock-write.ts";

/** The step every bump pull request belongs to: P2.26w pinned the first published images by hand (#1300). */
export const BUMP_STEP = "P2.26w";
/** The check that verifies a bump (lock.yml's job); auto-merge is turned on only when main requires it. */
export const LOCK_CHECK = "lock";
const API = "https://api.github.com";
const API_VERSION = "2026-03-10";
const COMMIT = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const ATTEMPT = /^[1-9][0-9]{0,3}$/;

export type BumpEnv = { REPO?: string; COMMIT?: string; RUN_ATTEMPT?: string; PUBLISHED_LOCK?: string };
export type BumpClient = {
  treeOf(commit: string): Promise<string>;
  createTree(baseTree: string, files: readonly { path: string; content: string }[]): Promise<string>;
  createCommit(message: string, tree: string, parent: string): Promise<string>;
  createBranch(name: string, sha: string): Promise<void>;
  openPull(pull: { title: string; head: string; body: string }): Promise<{ number: number; nodeId: string }>;
  /** The status check names main's active rules require. */
  requiredChecks(): Promise<string[]>;
  /** Squash auto-merge for the pull request, refused by GitHub unless its head is still `headSha`. */
  enableAutoMerge(nodeId: string, headSha: string): Promise<void>;
};
export type BumpDeps = {
  env: BumpEnv;
  github: BumpClient;
  readText: (path: string) => string;
  log: (line: string) => void;
};

const ANSWERS: Readonly<Record<string, (commit: string) => string>> = {
  Step: (commit) =>
    `${BUMP_STEP}, repeated by publish-images.yml for each publish run. This one pins the images built from ${commit}.`,
  What: () =>
    `\`${LOCK_PATH}\` and \`${COMPOSE_PATH}\` name the digests the publish run pushed, signed and verified. Written by \`scripts/ci/lock-write.ts\`; no other file changes.`,
  Why: () => "The stack runs only locked digests, so a published image is used only once the lock names it.",
  "How to test": () =>
    "The `lock` check verifies every entry's signature and provenance and refuses a move back to an older commit.",
  "Needs an ADR?": () => "No.",
};

/** The pull request body: every heading of the template, answered or n/a, so pr-shape reads it like any other. */
export function bumpBody(template: string, commit: string): string {
  const headings = [...template.replaceAll("\r", "").matchAll(/^## (.+?)\s*$/gm)].map((match) => match[1] as string);
  const sections = headings.map((heading) => `## ${heading}\n${ANSWERS[heading]?.(commit) ?? "n/a"}\n`);
  return [
    `Opened by \`publish-images.yml\` after it published ${commit}.\n`,
    ...sections,
    "AI notes: none needed\n",
  ].join("\n");
}

export const bumpTitle = (commit: string): string => `${BUMP_STEP} Pin the images published from ${commit.slice(0, 7)}`;

/** Exit code of one run: 0 when a pull request was opened or nothing changed, 1 on any refusal or error. */
export async function runBump({ env, github, readText, log }: BumpDeps): Promise<number> {
  const { REPO: repo = "", COMMIT: commit = "", RUN_ATTEMPT: attempt = "", PUBLISHED_LOCK: published = "" } = env;
  if (!REPO.test(repo) || !COMMIT.test(commit) || !ATTEMPT.test(attempt) || published === "") {
    log("lock-bump-pr: REPO, COMMIT, RUN_ATTEMPT or PUBLISHED_LOCK is missing or malformed");
    return 1;
  }
  try {
    const lock = readText(LOCK_PATH);
    const compose = readText(COMPOSE_PATH);
    const next = bumpedFiles(published, lock, compose, commit);
    if (next.lock === lock && next.compose === compose) {
      log("lock-bump-pr: the lock already names these images; no pull request");
      return 0;
    }
    const title = bumpTitle(commit);
    const tree = await github.createTree(await github.treeOf(commit), [
      { path: LOCK_PATH, content: next.lock },
      { path: COMPOSE_PATH, content: next.compose },
    ]);
    const message = `${title}\n\nWritten by scripts/ci/lock-write.ts from the lock publish-images.yml\nverified for ${commit}.\n`;
    const head = `lock-bump/${commit.slice(0, 12)}-${attempt}`;
    const made = await github.createCommit(message, tree, commit);
    await github.createBranch(head, made);
    const pull = await github.openPull({
      title,
      head,
      body: bumpBody(readText(".github/pull_request_template.md"), commit),
    });
    log(`lock-bump-pr: opened #${pull.number} from ${head}`);
    if (!(await github.requiredChecks()).includes(LOCK_CHECK)) {
      log(`lock-bump-pr: ${LOCK_CHECK} is not a required check on main; #${pull.number} waits for a person to merge`);
      return 0;
    }
    await github.enableAutoMerge(pull.nodeId, made);
    log(`lock-bump-pr: #${pull.number} merges itself once the required checks pass`);
    return 0;
  } catch (error) {
    log(`lock-bump-pr: ${error instanceof Error ? error.message : "failed"}`);
    return 1;
  }
}

type Json = Record<string, unknown>;

/** One call to api.github.com; the parsed JSON answer. */
async function request(token: string, path: string, body?: Json): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "unset-lock-bump",
      "X-GitHub-Api-Version": API_VERSION,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`github ${response.status} ${path}`);
  return response.json();
}

/** The string or number at `field` (dotted) of a JSON answer; throws when it is anything else. */
function fieldOf(answer: unknown, field: string, path: string): string | number {
  const value = field.split(".").reduce<unknown>((at, key) => (at as Json | undefined)?.[key], answer);
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`github answer lacks ${field}: ${path}`);
  return value;
}

const call = async (token: string, path: string, field: string, body?: Json): Promise<string | number> =>
  fieldOf(await request(token, path, body), field, path);

/** The `context` of every required status check in a "Get rules for a branch" answer; throws on another shape. */
export function requiredContexts(rules: unknown): string[] {
  if (!Array.isArray(rules)) throw new Error("the branch rules are not a list");
  const contexts: string[] = [];
  for (const rule of rules as Json[]) {
    if (rule?.type !== "required_status_checks") continue;
    const checks = (rule.parameters as Json | undefined)?.required_status_checks;
    if (!Array.isArray(checks)) throw new Error("a required_status_checks rule lists no checks");
    for (const check of checks as Json[]) {
      if (typeof check?.context !== "string") throw new Error("a required status check has no context");
      contexts.push(check.context);
    }
  }
  return contexts;
}

const ENABLE =
  "mutation($id:ID!,$oid:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH,expectedHeadOid:$oid}){pullRequest{number}}}";

/** The GitHub client; `repo` is owner/name, already checked. */
export function githubClient(token: string, repo: string): BumpClient {
  const root = `/repos/${repo}`;
  return {
    treeOf: async (commit) => String(await call(token, `${root}/git/commits/${commit}`, "tree.sha")),
    createTree: async (baseTree, files) => {
      const tree = files.map(({ path, content }) => ({ path, mode: "100644", type: "blob", content }));
      return String(await call(token, `${root}/git/trees`, "sha", { base_tree: baseTree, tree }));
    },
    createCommit: async (message, tree, parent) =>
      String(await call(token, `${root}/git/commits`, "sha", { message, tree, parents: [parent] })),
    createBranch: async (name, sha) => {
      await call(token, `${root}/git/refs`, "ref", { ref: `refs/heads/${name}`, sha });
    },
    openPull: async ({ title, head, body }) => {
      const path = `${root}/pulls`;
      const answer = await request(token, path, { title, head, base: "main", body });
      return { number: Number(fieldOf(answer, "number", path)), nodeId: String(fieldOf(answer, "node_id", path)) };
    },
    requiredChecks: async () => requiredContexts(await request(token, `${root}/rules/branches/main`)),
    enableAutoMerge: async (nodeId, headSha) => {
      // A GraphQL refusal is a 200 with `errors` (docs.github.com/en/graphql/guides/forming-calls-with-graphql).
      const answer = (await request(token, "/graphql", { query: ENABLE, variables: { id: nodeId, oid: headSha } })) as {
        errors?: { message?: string }[];
      };
      if (answer.errors !== undefined) {
        throw new Error(`auto-merge refused: ${String(answer.errors[0]?.message).slice(0, 200)}`);
      }
    },
  };
}

if (import.meta.main) {
  const token = process.env.GH_TOKEN ?? "";
  const repo = process.env.REPO ?? "";
  if (token === "" || !REPO.test(repo)) {
    console.error("lock-bump-pr: GH_TOKEN or REPO is missing");
    process.exit(1);
  }
  const root = join(import.meta.dirname, "..", "..");
  process.exitCode = await runBump({
    env: process.env,
    github: githubClient(token, repo),
    readText: (path) => readFileSync(join(root, path), "utf8"),
    log: console.error,
  });
}
