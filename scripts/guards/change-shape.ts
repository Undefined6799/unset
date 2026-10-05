// The pr-shape CI job (P0.09c): the title, every commit, the size, the template headings, the trusted base and the
// performance evidence of one pull request. `runChangeShape` is pure; `main` gathers its input from git and the
// environment and fails closed: a missing variable or a failed git call exits 1, never "nothing to check".

import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { checkCommitMessage, checkPrTitle } from "./commit-msg.ts";
import { type ChangedPath, classifyGrantChanges, type GrantFinding, type GrantSide } from "./grant-parse.ts";
import { checkPerfEvidence } from "./perf-evidence.ts";
import { measurePrSize } from "./pr-size.ts";
import { checkPrTemplate } from "./pr-template.ts";
import {
  checkPathsMixed,
  checkTrustedBaseIsolation,
  type DocFacts,
  readTrustedBase,
  type TrustedBase,
  unionTrustedBase,
} from "./trusted-base.ts";

export type ShapeInput = {
  title: string;
  body: string;
  labels: readonly string[];
  commits: readonly { sha: string; message: string }[];
  numstat: string;
  template: string;
  changedPaths: readonly string[];
  docs: DocFacts;
  trustedBase: TrustedBase;
  grantFindings: readonly GrantFinding[];
  migrationDiff: string;
};
export type ShapeResult = { errors: string[]; warnings: string[]; notices: string[] };

const MIGRATIONS = "infrastructure/postgres/migrations/";
const GRANT_MATRIX = "infrastructure/postgres/grant-matrix.json";
const ERASURE_REGISTRY = "infrastructure/postgres/erasure-registry.json";
/** The `# parsed:` paths this guard knows how to read; any other is an error, so nothing goes unparsed. */
const KNOWN_PARSED = [`/${MIGRATIONS}`, `/${GRANT_MATRIX}`, `/${ERASURE_REGISTRY}`];
const TEMPLATE = ".github/pull_request_template.md";
const GIT_TIMEOUT_MS = 30_000;

const describeFinding = (f: GrantFinding): string =>
  `[SE-6] ${f.path}:${f.line} ${f.reason}: ${f.statement.replace(/\s+/g, " ").trim().slice(0, 80)}`;

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

  const missing = checkPrTemplate(input.body, input.template);
  if (missing.length > 0) out.errors.push(`[DL-3] PR body is missing headings: ${missing.join(", ")}`);

  const { patterns, parsedPaths, checks } = input.trustedBase;
  const mixed = checkPathsMixed(input.changedPaths, checks, input.docs);
  if (mixed.length > 0)
    out.errors.push(`[SE-6] a PR that changes a check path changes no product path: ${mixed.join(", ")}`);
  const isolation = checkTrustedBaseIsolation(input.changedPaths, patterns, {
    parsedPaths,
    findings: input.grantFindings,
    docs: input.docs,
  });
  const trusted = input.grantFindings.filter((f) => f.kind === "trusted").map(describeFinding);
  if (!isolation.ok) {
    out.errors.push(
      `[SE-6] outside the trusted base in a trusted-base PR: ${isolation.outside.join(", ")}`,
      ...trusted,
    );
  } else {
    out.notices.push(...trusted);
  }

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
  const unknown = merged.parsedPaths.filter((p) => !KNOWN_PARSED.includes(p));
  if (unknown.length > 0) throw new Error(`the guard cannot parse "# parsed:" path(s) ${unknown.join(", ")}`);
  return merged;
}

/** `-z` output split on NUL. Without -z, git quotes a non-ASCII path (`"gat\303\251.ts"`) and no pattern matches. */
const fields = (output: string): string[] => output.split("\0").filter((field) => field !== "");

type RawChange = ChangedPath & { mode: string };

/** `git diff -z --raw` rows: status and the head-side mode, so a symlink (120000) is never read as a regular file. */
function changedFiles(base: string, head: string): RawChange[] {
  const parts = fields(git("diff", "-z", "--raw", "--no-renames", `${base}...${head}`));
  const changed: RawChange[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [, mode = "", , , status = ""] = (parts[i] as string).split(" ");
    changed.push({ path: parts[i + 1] as string, status: status.charAt(0) as ChangedPath["status"], mode });
  }
  return changed;
}

/** A modified package.json whose base and head parse to the same object once `license` is dropped. */
function changesOnlyLicence(base: string, head: string, path: string): boolean {
  try {
    const [before, after] = [base, head].map((sha) => {
      const { license: _, ...rest } = JSON.parse(git("show", `${sha}:${path}`)) as Record<string, unknown>;
      return rest;
    });
    return isDeepStrictEqual(before, after);
  } catch {
    return false; // unreadable either side: not documentation
  }
}

function docFacts(base: string, head: string, changed: readonly RawChange[]): DocFacts {
  const regular = changed.filter((c) => c.mode === "100644").map((c) => c.path);
  const manifests = changed.filter((c) => c.status === "M" && /^[^/]+\/[^/]+\/package\.json$/.test(c.path));
  return {
    regular: new Set(regular),
    licenceOnly: new Set(manifests.filter((c) => changesOnlyLicence(base, head, c.path)).map((c) => c.path)),
  };
}

/** `git diff -z --numstat` rows as the tab-separated lines measurePrSize reads; a path with a newline is refused. */
function numstat(base: string, head: string): string {
  const rows = fields(git("diff", "-z", "--numstat", "--no-renames", `${base}...${head}`));
  if (rows.some((row) => row.includes("\n"))) throw new Error("a changed path contains a newline");
  return rows.join("\n");
}

function grantSide(sha: string, migrations: readonly string[]): GrantSide {
  return {
    migrations: migrations.map((path) => ({ path, sql: git("show", `${sha}:${path}`) })),
    grantMatrix: fileAt(sha, GRANT_MATRIX),
    erasureRegistry: fileAt(sha, ERASURE_REGISTRY),
  };
}

function gather(env: Record<string, string>, base: string, head: string): ShapeInput {
  const labels: unknown = JSON.parse(env.PR_LABELS as string);
  if (!Array.isArray(labels) || !labels.every((l) => typeof l === "string"))
    throw new Error("PR_LABELS is not a JSON array of names");
  const trustedBase = trustedBaseOf(base, head);
  const changed = changedFiles(base, head);
  const baseMigrations = fields(git("ls-tree", "-z", "-r", "--name-only", base, "--", MIGRATIONS));
  const headMigrations = changed.filter((c) => c.path.startsWith(MIGRATIONS) && c.status !== "D").map((c) => c.path);
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
    commits,
    numstat: numstat(base, head),
    // The base's template: a PR cannot drop a heading by deleting it from the template.
    template: fileAt(base, TEMPLATE) ?? "",
    changedPaths: changed.map((c) => c.path),
    docs: docFacts(base, head, changed),
    trustedBase,
    grantFindings: classifyGrantChanges({
      base: grantSide(base, baseMigrations),
      head: grantSide(head, headMigrations),
      changed,
      trustedFunctions: trustedBase.trustedFunctions,
    }),
    migrationDiff: git("diff", "-U0", `${base}...${head}`, "--", MIGRATIONS),
  };
}

/** Workflow-command data: `%`, CR and LF are escaped so a message stays one annotation. */
const commandData = (text: string): string =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

function main(): number {
  const names = ["PR_TITLE", "PR_BODY", "PR_LABELS", "BASE_SHA", "HEAD_SHA"] as const;
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
    console.log("pr-shape: title, commits, size, template, trusted base and evidence pass");
  return result.errors.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
