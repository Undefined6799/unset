// Squash auto-merge for a docs-only pull request (P0.07e; ADR 0034).
// workflow_run runs the default-branch copy; GITHUB_SHA is that branch
// (docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
// It never checks out pull request code (docs.github.com/en/actions/reference/security/secure-use).
// A fork's pull_request token is read-only (same events doc); this script also refuses a foreign head.
//
// Read 2026-10-21: enablePullRequestAutoMerge mergeMethod defaults to MERGE, so this passes
// SQUASH; omitted commitHeadline uses "a default message" (whether that is squash_merge_commit_title
// COMMIT_OR_PR_TITLE is unverified). pull-requests: write includes read
// (docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#permissions).
// File lists cap at 3000. Check runs use filter=all; only Actions app 15368 counts.
// X-GitHub-Api-Version: 2026-03-10 (docs.github.com/en/rest/pulls/pulls).
import { type ChangedPath, docsOnlyRejection } from "./docs-only-paths.ts";

export const DOCS_ONLY_WORKFLOW = ".github/workflows/docs-only.yml";
export const DOCS_ONLY_CHECK = "docs-only";
export const DOCS_LABEL = "kind/docs";
const ACTIONS_APP = 15368;
const API = "https://api.github.com";
const API_VERSION = "2026-03-10";
const FILE_CAP = 3000;
const PAGE_CAP = 40;

export type CheckState = "success" | "failure" | "skipped" | "pending" | "missing" | "error";
export type AutoMergeState = "squash" | "other" | "off" | "unknown";
export type AutoMergeAction = "enable" | "disable" | "leave";

export type AutoMergeFacts = {
  sameRepo: boolean;
  draft: boolean;
  labels: readonly string[];
  paths: readonly ChangedPath[];
  pathsError: boolean;
  check: CheckState;
  autoMerge: AutoMergeState;
};

export type PullSnapshot = {
  number: number;
  nodeId: string;
  state: string;
  draft: boolean;
  headSha: string;
  headRepo: string;
  labels: readonly string[];
  autoMerge: AutoMergeState;
};

export type MergeClient = {
  pullsForCommit(sha: string): Promise<readonly number[]>;
  pull(number: number): Promise<PullSnapshot>;
  files(number: number): Promise<readonly ChangedPath[]>;
  check(sha: string): Promise<CheckState>;
  enable(nodeId: string, sha: string): Promise<void>;
  disable(nodeId: string): Promise<void>;
};

export type AutoMergeEnv = {
  REPO?: string;
  HEAD_SHA?: string;
  HEAD_REPO?: string;
  WORKFLOW_PATH?: string;
  WORKFLOW_EVENT?: string;
  PR_NUMBERS?: string;
};

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[^/\s]+\/[^/\s]+$/;

/** Enable only when every gate holds. Any doubt, or an auto-merge that is not squash, turns it off. */
export function decide(facts: AutoMergeFacts): AutoMergeAction {
  const allowed = docsOnlyRejection(facts.paths) === null;
  const eligible =
    facts.sameRepo &&
    !facts.draft &&
    !facts.pathsError &&
    facts.check === "success" &&
    facts.labels.includes(DOCS_LABEL) &&
    allowed;
  const broken = facts.pathsError || facts.check === "error" || facts.autoMerge === "unknown";
  if (broken || !eligible) return facts.autoMerge === "off" ? "leave" : "disable";
  return facts.autoMerge === "squash" ? "leave" : "enable";
}

/** `toJSON` of the workflow_run pull_requests numbers, or null when the payload has none. */
export function parsePrNumbers(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === "" || raw.trim() === "null") return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("pull request numbers are not a list");
  const numbers = parsed.map((value) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error("pull request number");
    return value;
  });
  return [...new Set(numbers)];
}

export async function runAutoMerge(env: AutoMergeEnv, github: MergeClient): Promise<number> {
  if (!env.REPO || !REPO.test(env.REPO) || !env.HEAD_SHA || !SHA.test(env.HEAD_SHA)) {
    console.error("docs-auto-merge: REPO or HEAD_SHA is missing");
    return 1;
  }
  if (!env.WORKFLOW_PATH || !env.WORKFLOW_EVENT) {
    console.error("docs-auto-merge: workflow path or event is missing");
    return 1;
  }
  if (env.WORKFLOW_PATH !== DOCS_ONLY_WORKFLOW || env.WORKFLOW_EVENT !== "pull_request") {
    console.log("docs-auto-merge: ignoring a run that is not the docs-only pull request check");
    return 0;
  }
  const headSha = env.HEAD_SHA;
  const sameRepo = (env.HEAD_REPO ?? "").toLowerCase() === env.REPO.toLowerCase();
  let numbers: number[];
  try {
    numbers = parsePrNumbers(env.PR_NUMBERS);
    if (numbers.length === 0) numbers = [...(await github.pullsForCommit(headSha))];
  } catch (error) {
    console.error(`docs-auto-merge: ${error instanceof Error ? error.message : "pull request lookup failed"}`);
    return 1;
  }
  if (numbers.length !== 1) {
    if (!sameRepo && numbers.length === 0) {
      console.log("docs-auto-merge: fork, no pull request to change");
      return 0;
    }
    console.error(`docs-auto-merge: expected one pull request, found ${numbers.length}`);
    await disableEach(numbers, github);
    return 1;
  }
  const number = numbers[0];
  if (number === undefined) return 1;
  let pull: PullSnapshot;
  try {
    pull = await github.pull(number);
  } catch (error) {
    console.error(`docs-auto-merge: ${error instanceof Error ? error.message : "pull request read failed"}`);
    return 1;
  }
  if (pull.state !== "open") return 0;
  if (pull.headSha !== headSha) {
    console.log(`docs-auto-merge: #${pull.number} head moved; leaving it`);
    return 0;
  }
  let paths: readonly ChangedPath[] = [];
  let pathsError = false;
  let check: CheckState = "error";
  try {
    paths = await github.files(pull.number);
    check = await github.check(headSha);
  } catch (error) {
    pathsError = true;
    console.error(`docs-auto-merge: ${error instanceof Error ? error.message : "file list failed"}`);
  }
  const facts: AutoMergeFacts = {
    sameRepo: sameRepo && pull.headRepo.toLowerCase() === env.REPO.toLowerCase(),
    draft: pull.draft,
    labels: pull.labels,
    paths,
    pathsError,
    check,
    autoMerge: pull.autoMerge,
  };
  const action = decide(facts);
  console.log(`docs-auto-merge: #${pull.number} ${action}`);
  try {
    if (action === "enable") await github.enable(pull.nodeId, headSha);
    if (action === "disable") await github.disable(pull.nodeId);
  } catch (error) {
    console.error(`docs-auto-merge: ${error instanceof Error ? error.message : "auto-merge update failed"}`);
    return 1;
  }
  return pathsError || check === "error" ? 1 : 0;
}

/** When the run cannot tell which pull request it judged, none of them keeps auto-merge (P0.07k). Best effort. */
async function disableEach(numbers: readonly number[], github: MergeClient): Promise<void> {
  for (const number of numbers) {
    try {
      const pull = await github.pull(number);
      if (pull.autoMerge === "off") continue;
      await github.disable(pull.nodeId);
      console.log(`docs-auto-merge: #${pull.number} disable`);
    } catch (error) {
      console.error(`docs-auto-merge: ${error instanceof Error ? error.message : "auto-merge update failed"}`);
    }
  }
}

type Json = Record<string, unknown>;

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "unset-docs-auto-merge",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

async function getJson(token: string, url: string): Promise<{ body: unknown; next: string | null }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.host !== "api.github.com") throw new Error("refusing a non-GitHub URL");
  const response = await fetch(parsed, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`github ${response.status} ${parsed.pathname}`);
  const next = nextLink(response.headers.get("link"));
  return { body: await response.json(), next };
}

function nextLink(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part);
    const url = match?.[1];
    if (url !== undefined) return url;
  }
  return null;
}

function asObject(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what} is not an object`);
  return value as Json;
}

function readAutoMerge(value: unknown): AutoMergeState {
  if (value === null) return "off";
  const record = asObject(value, "auto_merge");
  if (record.merge_method === "squash") return "squash";
  if (typeof record.merge_method === "string") return "other";
  return "unknown";
}

function readPaths(entries: unknown): ChangedPath[] {
  if (!Array.isArray(entries)) throw new Error("file list is not a list");
  return entries.map((entry) => {
    const record = asObject(entry, "file");
    if (typeof record.filename !== "string") throw new Error("file name missing");
    const status = record.status;
    const previous = record.previous_filename;
    if ((status === "renamed" || status === "copied") && typeof previous !== "string") {
      throw new Error("rename has no previous name");
    }
    if (typeof previous === "string") return { path: record.filename, previous };
    return { path: record.filename };
  });
}

function isActionsDocsCheck(run: unknown): run is Json {
  if (typeof run !== "object" || run === null) return false;
  const item = run as Json;
  if (item.name !== DOCS_ONLY_CHECK) return false;
  if (typeof item.app !== "object" || item.app === null) return false;
  const app = item.app as Json;
  return app.id === ACTIONS_APP && app.slug === "github-actions";
}

function readCheck(body: unknown): CheckState {
  const record = asObject(body, "check runs");
  const runs = record.check_runs;
  if (!Array.isArray(runs)) throw new Error("check runs missing");
  const ours = runs.filter(isActionsDocsCheck);
  if (ours.length === 0) return "missing";
  const completed = ours.filter((run) => run.status === "completed" && typeof run.completed_at === "string");
  completed.sort((a, b) => (String(a.completed_at) < String(b.completed_at) ? 1 : -1));
  const latest = completed[0];
  if (latest === undefined) return "pending";
  if (latest.conclusion === "success") return "success";
  if (latest.conclusion === "skipped") return "skipped";
  return "failure";
}

async function pages(token: string, path: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let url: string | null = `${API}${path}`;
  for (let page = 0; page < PAGE_CAP && url !== null; page++) {
    const { body, next } = await getJson(token, url);
    if (!Array.isArray(body)) throw new Error("paged list is not a list");
    out.push(...body);
    url = next;
    if (out.length > FILE_CAP) throw new Error("file list truncated");
  }
  if (url !== null) throw new Error("file list truncated");
  return out;
}

const ENABLE =
  "mutation($id:ID!,$oid:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH,expectedHeadOid:$oid}){pullRequest{number}}}";
const DISABLE = "mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){pullRequest{number}}}";

async function graphql(token: string, query: string, variables: Record<string, string>): Promise<void> {
  const response = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { errors?: { message?: string }[] };
  const message = body.errors?.[0]?.message;
  if (!response.ok || message !== undefined) throw new Error((message ?? `github ${response.status}`).slice(0, 200));
}

/** The GitHub client. `owner` and `repo` are the base repository, already split. */
export function githubClient(token: string, owner: string, repo: string): MergeClient {
  const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return {
    async pullsForCommit(sha) {
      const { body, next } = await getJson(token, `${API}${root}/commits/${sha}/pulls?per_page=100`);
      if (next !== null) throw new Error("commit pulls truncated");
      if (!Array.isArray(body)) throw new Error("commit pulls are not a list");
      return body.map((entry) => {
        const number = asObject(entry, "pull").number;
        if (typeof number !== "number" || !Number.isInteger(number)) throw new Error("pull number");
        return number;
      });
    },
    async pull(number) {
      const { body } = await getJson(token, `${API}${root}/pulls/${number}`);
      const record = asObject(body, "pull request");
      const head = asObject(record.head, "head");
      const headRepo = asObject(head.repo, "head repo");
      const labels = record.labels;
      if (!Array.isArray(labels)) throw new Error("labels missing");
      const names = labels.map((label) => {
        const name = asObject(label, "label").name;
        if (typeof name !== "string") throw new Error("label name");
        return name;
      });
      if (typeof record.number !== "number" || typeof record.node_id !== "string") throw new Error("pull identity");
      if (typeof record.state !== "string" || typeof record.draft !== "boolean") throw new Error("pull state");
      if (typeof head.sha !== "string" || typeof headRepo.full_name !== "string") throw new Error("pull head");
      return {
        number: record.number,
        nodeId: record.node_id,
        state: record.state,
        draft: record.draft,
        headSha: head.sha,
        headRepo: headRepo.full_name,
        labels: names,
        autoMerge: readAutoMerge(record.auto_merge),
      };
    },
    async files(number) {
      const entries = await pages(token, `${root}/pulls/${number}/files?per_page=100`);
      if (entries.length >= FILE_CAP) throw new Error("file list truncated");
      return readPaths(entries);
    },
    async check(sha) {
      const runs: unknown[] = [];
      const name = encodeURIComponent(DOCS_ONLY_CHECK);
      let url: string | null = `${API}${root}/commits/${sha}/check-runs?check_name=${name}&filter=all&per_page=100`;
      for (let page = 0; page < 5 && url !== null; page++) {
        const { body, next } = await getJson(token, url);
        const record = asObject(body, "check runs");
        if (!Array.isArray(record.check_runs)) throw new Error("check runs missing");
        runs.push(...record.check_runs);
        url = next;
      }
      if (url !== null) throw new Error("check runs truncated");
      return readCheck({ check_runs: runs });
    },
    async enable(nodeId, sha) {
      await graphql(token, ENABLE, { id: nodeId, oid: sha });
    },
    async disable(nodeId) {
      await graphql(token, DISABLE, { id: nodeId });
    },
  };
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const slash = repo.indexOf("/");
  if (!REPO.test(repo) || slash < 1) throw new Error("REPO must be owner/name");
  return { owner: repo.slice(0, slash), repo: repo.slice(slash + 1) };
}

if (import.meta.main) {
  const token = process.env.GH_TOKEN ?? "";
  if (token === "") {
    console.error("docs-auto-merge: GH_TOKEN is missing");
    process.exitCode = 1;
  } else {
    try {
      const parts = splitRepo(process.env.REPO ?? "");
      const code = await runAutoMerge(process.env, githubClient(token, parts.owner, parts.repo));
      process.exitCode = code;
    } catch (error) {
      console.error(`docs-auto-merge: ${error instanceof Error ? error.message : "failed"}`);
      process.exitCode = 1;
    }
  }
}
