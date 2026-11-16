// The pr-shape CI job (P0.09c): the title, every commit, the size, the template headings, the trusted-path label and
// the performance evidence of one pull request. `runChangeShape` is pure; `main` gathers its input from git and the
// environment and fails closed: a missing variable or a failed git call exits 1, never "nothing to check".

import { execFileSync } from "node:child_process";
import { checkCommitMessage, checkPrTitle } from "./commit-msg.ts";
import { checkPerfEvidence } from "./perf-evidence.ts";
import { measurePrSize, NUMSTAT_ARGS, numstatLines } from "./pr-size.ts";
import { checkPrTemplate } from "./pr-template.ts";
import { readTrustedBase, type TrustedBase, trustedPathsChanged, unionTrustedBase } from "./trusted-base.ts";

export type ShapeInput = {
  title: string;
  body: string;
  labels: readonly string[];
  /** The PR's author as GitHub reports it: `user.login` and `user.type` ("User" or "Bot"). */
  author: { login: string; type: string };
  commits: readonly { sha: string; message: string }[];
  numstat: string;
  template: string;
  changedPaths: readonly string[];
  trustedBase: TrustedBase;
  migrationDiff: string;
};
export type ShapeResult = { errors: string[]; warnings: string[]; notices: string[] };

const MIGRATIONS = "infrastructure/postgres/migrations/";
const TEMPLATE = ".github/pull_request_template.md";
const GIT_TIMEOUT_MS = 30_000;
/** Renovate writes its own PR body, so it alone skips the template headings (P0.09i, rule DL-3). */
const isRenovate = (author: ShapeInput["author"]): boolean => author.login === "renovate[bot]" && author.type === "Bot";

/** The label a pull request that changes a trusted path must carry (rule SE-6 as amended by ADR 0044). */
export const SECURITY_REVIEW = "security-review";
const LISTED_AT_MOST = 20;

/**
 * SE-6 (ADR 0044): a change to a trusted path is named, not isolated. Without the label the job fails. With it the job
 * lists the trusted paths as a notice, so the reviewer sees what the review must cover. No author is exempt: Renovate
 * labels its own pull requests (`.github/renovate.json`), so a commit pushed to one of its branches gets no free pass.
 */
function trustedPathLines(input: ShapeInput): { error?: string; notice?: string } {
  const trusted = trustedPathsChanged(input.changedPaths, input.trustedBase);
  if (trusted.length === 0) return {};
  const more = trusted.length > LISTED_AT_MOST ? `, and ${trusted.length - LISTED_AT_MOST} more` : "";
  const paths = `${trusted.slice(0, LISTED_AT_MOST).join(", ")}${more}`;
  if (!input.labels.includes(SECURITY_REVIEW))
    return { error: `[SE-6] a PR that changes a trusted path carries the ${SECURITY_REVIEW} label: ${paths}` };
  return { notice: `[SE-6] trusted paths in this PR, for the security review of this head: ${paths}` };
}

function kindLabelWarning(labels: readonly string[]): string[] {
  const kinds = labels.filter((label) => label.startsWith("kind/"));
  if (kinds.length === 1) return [];
  return [`[D2] expected exactly one kind/* label, found ${kinds.length === 0 ? "none" : kinds.join(", ")}`];
}

export function runChangeShape(input: ShapeInput): ShapeResult {
  const out: ShapeResult = { errors: [], warnings: kindLabelWarning(input.labels), notices: [] };
  const title = checkPrTitle(input.title);
  if (!title.ok) out.errors.push(`[D2] PR title: ${title.errors.join(", ")}`);
  for (const commit of input.commits) {
    const result = checkCommitMessage(commit.message);
    if (!result.ok) out.errors.push(`[D2] commit ${commit.sha.slice(0, 7)}: ${result.errors.join(", ")}`);
  }

  const size = measurePrSize(input.numstat, input.labels, input.body);
  const sizeLine = `[D3] PR size: ${size.changed} changed source lines: ${size.reason}`;
  if (size.level === "fail") out.errors.push(sizeLine);
  if (size.level === "warn") out.warnings.push(sizeLine);

  const missing = isRenovate(input.author) ? [] : checkPrTemplate(input.body, input.template);
  if (missing.length > 0) out.errors.push(`[DL-3] PR body is missing headings: ${missing.join(", ")}`);

  const trusted = trustedPathLines(input);
  if (trusted.error !== undefined) out.errors.push(trusted.error);
  if (trusted.notice !== undefined) out.notices.push(trusted.notice);

  if (checkPerfEvidence(input.migrationDiff, input.body)) {
    out.errors.push("[PF-1] a `-- why: speed` index needs p50, p95 and p99 before and after in Performance evidence");
  }
  return out;
}

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 });

/** A file's content at a commit, or null when the commit does not have it. */
function fileAt(sha: string, path: string): string | null {
  return git("ls-tree", "-z", "--name-only", sha, "--", path) === "" ? null : git("show", `${sha}:${path}`);
}

/** Both CODEOWNERS sections, merged (unionTrustedBase), and checked for what this guard needs. */
function trustedBaseOf(base: string, head: string): TrustedBase {
  const [baseSection, headSection] = [base, head].map((sha) => {
    const read = readTrustedBase(fileAt(sha, ".github/CODEOWNERS") ?? "");
    if (!read.ok) throw new Error(`.github/CODEOWNERS at ${sha.slice(0, 7)}: ${read.error}`);
    return read.section;
  }) as [TrustedBase, TrustedBase];
  const merged = unionTrustedBase(baseSection, headSection);
  if (merged.checks.length === 0) throw new Error('neither CODEOWNERS section has "# checks:" paths');
  return merged;
}

/** `-z` output split on NUL. Without -z, git quotes a non-ASCII path (`"gat\303\251.ts"`) and no pattern matches. */
const fields = (output: string): string[] => output.split("\0").filter((field) => field !== "");

/** The changed paths. With `--no-renames` a rename is a deletion and an addition, so both its paths are named. */
const changedPaths = (base: string, head: string): string[] =>
  fields(git("diff", "-z", "--name-only", "--no-renames", `${base}...${head}`));

/** The numstat lines measurePrSize reads, with renames paired (P0.09h). */
const numstat = (base: string, head: string): string => numstatLines(git("diff", ...NUMSTAT_ARGS, `${base}...${head}`));

function gather(env: Record<string, string>, base: string, head: string): ShapeInput {
  const labels: unknown = JSON.parse(env.PR_LABELS as string);
  if (!Array.isArray(labels) || !labels.every((l) => typeof l === "string"))
    throw new Error("PR_LABELS is not a JSON array of names");
  // A commit message cannot hold a NUL, so sha and message alternate between NULs.
  const log = git("log", "--no-merges", "--format=%H%x00%B%x00", `${base}..${head}`).split("\0");
  const commits: { sha: string; message: string }[] = [];
  for (let i = 0; i + 1 < log.length; i += 2) {
    commits.push({ sha: (log[i] as string).trim(), message: log[i + 1] as string });
  }
  return {
    title: env.PR_TITLE as string,
    body: env.PR_BODY as string,
    labels,
    author: { login: env.PR_AUTHOR as string, type: env.PR_AUTHOR_TYPE as string },
    commits,
    numstat: numstat(base, head),
    // The base's template: a PR cannot drop a heading by deleting it from the template.
    template: fileAt(base, TEMPLATE) ?? "",
    changedPaths: changedPaths(base, head),
    trustedBase: trustedBaseOf(base, head),
    migrationDiff: git("diff", "-U0", `${base}...${head}`, "--", MIGRATIONS),
  };
}

/** Workflow-command data: `%`, CR and LF are escaped so a message stays one annotation. */
const commandData = (text: string): string =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

function main(): number {
  const names = ["PR_TITLE", "PR_BODY", "PR_LABELS", "PR_AUTHOR", "PR_AUTHOR_TYPE", "BASE_SHA", "HEAD_SHA"] as const;
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value === undefined) {
      console.log(`::error::${name} is not set: pr-shape runs only on a pull_request event`);
      return 1;
    }
    env[name] = value;
  }
  for (const name of ["BASE_SHA", "HEAD_SHA"] as const) {
    // A full commit id only: anything else could reach git as an option.
    if (!/^[0-9a-f]{40}$/.test(env[name] as string)) {
      console.log(`::error::${name} is not a commit id`);
      return 1;
    }
  }
  let result: ShapeResult;
  try {
    result = runChangeShape(gather(env, env.BASE_SHA as string, env.HEAD_SHA as string));
  } catch (error) {
    console.log(`::error::pr-shape could not read the pull request: ${commandData(String(error))}`);
    return 1;
  }
  for (const line of result.notices) console.log(`::notice::${commandData(line)}`);
  for (const line of result.warnings) console.log(`::warning::${commandData(line)}`);
  for (const line of result.errors) console.log(`::error::${commandData(line)}`);
  if (result.errors.length === 0)
    console.log("pr-shape: title, commits, size, template, trusted-path label and evidence pass");
  return result.errors.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
