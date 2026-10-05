// Commit subjects and the PR title (P0.09c; rules D2, DL-6): Beams' rules with our step-id prefix. Under
// squash-only merging the PR title becomes the subject on main, so it gets the same subject rules.
// "Imperative mood" stays review-only: no check tells it apart reliably.

import { readFileSync } from "node:fs";

export type CommitMsgError =
  | "subject.no_step_id"
  | "subject.conventional_prefix"
  | "subject.lowercase"
  | "subject.trailing_period"
  | "subject.too_long"
  | "body.no_blank_line"
  | "body.line_too_long";
export type CommitMsgResult = { ok: true } | { ok: false; errors: CommitMsgError[] };

const STEP_ID = /^(P[0-6]\.\d{2}[a-z]?|L\.\d{2}[a-z]?)$/;
const CONVENTIONAL = /^[a-z]+(\(.+\))?!?: /;
const REVERT = /^Revert "(.*)"$/;
/** The merge subjects git and GitHub write; `git merge` runs the commit-msg hook too. */
const MERGE = /^Merge (branch|remote-tracking branch|pull request #\d+ from|commit) /;
const URL_ONLY = /^\s*<?https?:\/\/\S+>?\s*$/;
const SUMMARY_MAX = 50;
const SUBJECT_MAX = 72;
const BODY_MAX = 72;

function subjectErrors(subject: string): CommitMsgError[] {
  const reverted = REVERT.exec(subject)?.[1];
  if (reverted !== undefined) return subjectErrors(reverted);
  const space = subject.indexOf(" ");
  const id = space === -1 ? subject : subject.slice(0, space);
  const conventional = CONVENTIONAL.test(subject) ? ["subject.conventional_prefix" as const] : [];
  // Without a step id the rest of the subject is not measured: the id is what the author must add first.
  if (!STEP_ID.test(id)) return ["subject.no_step_id", ...conventional];

  // A bare step id has an empty summary, which fails as not starting with a capital letter.
  const summary = space === -1 ? "" : subject.slice(space + 1);
  const errors: CommitMsgError[] = [];
  if (CONVENTIONAL.test(summary)) errors.push("subject.conventional_prefix");
  else if (!/^\p{Lu}/u.test(summary)) errors.push("subject.lowercase");
  if (summary.endsWith(".")) errors.push("subject.trailing_period");
  if (summary.length > SUMMARY_MAX || subject.length > SUBJECT_MAX) errors.push("subject.too_long");
  return errors;
}

function bodyErrors(lines: readonly string[]): CommitMsgError[] {
  if (lines.length === 0) return [];
  const errors: CommitMsgError[] = [];
  if (lines[0]?.trim() !== "") errors.push("body.no_blank_line");
  if (lines.some((line) => line.length > BODY_MAX && !URL_ONLY.test(line))) errors.push("body.line_too_long");
  return errors;
}

export function checkCommitMessage(message: string): CommitMsgResult {
  const lines = message.split(/\r?\n/);
  while (lines.length > 1 && lines.at(-1)?.trim() === "") lines.pop();
  // Trailing spaces would hide a trailing period.
  const subject = (lines[0] ?? "").trimEnd();
  const errors = [...subjectErrors(subject), ...bodyErrors(lines.slice(1))];
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** The title becomes the squash subject, so it is one line held to the subject rules. */
export function checkPrTitle(title: string): CommitMsgResult {
  const errors = subjectErrors(title.trim());
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** The message as git stores it: comment lines and everything below the scissors line are dropped. */
export function stripGitComments(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const scissors = lines.findIndex((line) => /^# -+ >8 -+$/.test(line));
  return (scissors === -1 ? lines : lines.slice(0, scissors)).filter((line) => !line.startsWith("#")).join("\n");
}

// The commit-msg hook: `node scripts/guards/commit-msg.ts <message file>`.
if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: commit-msg.ts <message file>");
    process.exit(2);
  }
  const message = stripGitComments(readFileSync(file, "utf8"));
  // Only the hook passes merge subjects (`git merge` runs it); CI reads commits with --no-merges, so a regular
  // commit that merely says "Merge …" is still checked there.
  const result = MERGE.test(message) ? ({ ok: true } as const) : checkCommitMessage(message);
  if (!result.ok) {
    console.error(`commit-msg: ${result.errors.join(", ")}`);
    console.error('Write "<step id> <Capitalised summary>", e.g. "P1.07 Enforce exact Origin match in CSRF gate".');
    process.exit(1);
  }
}
