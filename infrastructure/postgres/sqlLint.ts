// The migration lint (P1.11; plan §5.2 expand-then-contract, §6.1 index rule PF-1). It reads SQL as text, so a
// keyword inside a string or a function body also counts: the lint fails closed rather than parse SQL.
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Phase = "expand" | "contract";

/** One refused construct: the 1-based line it starts on and a fixed rule word. */
export type LintProblem = { readonly line: number; readonly rule: string };

/** What an expand migration may not do: each breaks code from the previous release that still runs during a deploy. */
const EXPAND_FORBIDDEN: readonly { rule: string; pattern: RegExp }[] = [
  { rule: "drop", pattern: /\bDROP\s+(?:TABLE|COLUMN|SCHEMA)\b/gi },
  // `ALTER TABLE t DROP y` drops column y without the COLUMN keyword; constraints, defaults and NOT NULL are not data.
  {
    rule: "drop",
    pattern:
      /\bALTER\s+TABLE\b[^;]*?\bDROP\s+(?!COLUMN\b|CONSTRAINT\b|DEFAULT\b|NOT\s+NULL\b|IDENTITY\b|EXPRESSION\b)\w/gi,
  },
  { rule: "rename", pattern: /\bRENAME\b/gi },
  { rule: "alter_type", pattern: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/gi },
  { rule: "set_not_null", pattern: /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/gi },
  { rule: "truncate", pattern: /\bTRUNCATE\b/gi },
];

const EVENT = "(?:INSERT|UPDATE|DELETE|TRUNCATE)";
/**
 * A `CREATE TRIGGER` clause from `CREATE` through `ON`, events joined by `OR` with no `UPDATE OF` column list
 * (PostgreSQL 18 CREATE TRIGGER, https://www.postgresql.org/docs/18/sql-createtrigger.html). TRUNCATE here names a
 * trigger event, which guards a table rather than emptying it, so the expand rule skips it there and nowhere else
 * (architecture ruling 2026-10-06 23:10Z, P1.15x). A clause that does not match keeps its TRUNCATE reported.
 */
export const TRIGGER_EVENTS = new RegExp(
  `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+(?:\\w+|"[^"]+")\\s+` +
    `(?:BEFORE|AFTER|INSTEAD\\s+OF)\\s+${EVENT}(?:\\s+OR\\s+${EVENT})*\\s+ON\\b`,
  "gi",
);

const CREATE_INDEX = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?\s+("?)(\w+)\1/gi;
const DROP_INDEX = /\bDROP\s+INDEX\b(\s+CONCURRENTLY\s+IF\s+EXISTS\s+("?)(\w+)\2)?/gi;
const QUERY_LINE = /^\s*--\s*query:\s*(\S+)\s*$/;
const WHY_LINE = /^\s*--\s*why:\s*(?:unique|foreign-key|speed)\s*$/;

/** The SQL with `--` comments blanked, so offsets and line numbers stay those of the file. */
const withoutComments = (sql: string): string => sql.replace(/--[^\n]*/g, (comment) => " ".repeat(comment.length));

const lineAt = (sql: string, offset: number): number => sql.slice(0, offset).split("\n").length;

/**
 * Refused constructs, in line order. Expand files may only add; every file's `CREATE INDEX` carries `-- query:` and
 * `-- why:` on the two lines just above it, and `query:` names a file under `root` (`path` or `path:symbol`).
 */
export function lintMigration(sql: string, phase: Phase, root: string): LintProblem[] {
  const code = withoutComments(sql);
  const problems: LintProblem[] = [...indexProblems(sql, code, root)];
  if (phase === "expand") problems.push(...expandProblems(code));
  return problems.sort((a, b) => a.line - b.line);
}

/** The code with each TRUNCATE inside a trigger's event list blanked in place, so offsets and lines stay the same. */
const withoutTriggerEvents = (code: string): string =>
  code.replace(TRIGGER_EVENTS, (clause) => clause.replace(/\bTRUNCATE\b/gi, (word) => " ".repeat(word.length)));

function expandProblems(code: string): LintProblem[] {
  const created = new Set([...code.matchAll(CREATE_INDEX)].map((m) => (m[2] ?? "").toLowerCase()));
  const checked = withoutTriggerEvents(code);
  const problems = EXPAND_FORBIDDEN.flatMap(({ rule, pattern }) =>
    [...checked.matchAll(pattern)].map((m) => ({ line: lineAt(checked, m.index), rule })),
  );
  for (const m of code.matchAll(DROP_INDEX)) {
    // Dropping an index this same file created (a failed `CONCURRENTLY` build being retried) is the one exception.
    const own = m[1] !== undefined && created.has((m[3] ?? "").toLowerCase());
    if (!own) problems.push({ line: lineAt(code, m.index), rule: "drop" });
  }
  return problems;
}

function indexProblems(sql: string, code: string, root: string): LintProblem[] {
  const lines = sql.split("\n");
  return [...code.matchAll(CREATE_INDEX)].flatMap((m) => {
    const line = lineAt(code, m.index);
    const query = QUERY_LINE.exec(lines[line - 3] ?? "");
    if (!query || !WHY_LINE.test(lines[line - 2] ?? "")) return [{ line, rule: "index_comment" }];
    const file = (query[1] ?? "").split(":")[0] ?? "";
    const inside = file !== "" && !file.startsWith("/") && !file.split("/").includes("..");
    return inside && existsSync(join(root, file)) ? [] : [{ line, rule: "index_query_file" }];
  });
}
