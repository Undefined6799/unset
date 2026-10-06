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

function expandProblems(code: string): LintProblem[] {
  const created = new Set([...code.matchAll(CREATE_INDEX)].map((m) => (m[2] ?? "").toLowerCase()));
  const problems = EXPAND_FORBIDDEN.flatMap(({ rule, pattern }) =>
    [...code.matchAll(pattern)].map((m) => ({ line: lineAt(code, m.index), rule })),
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
