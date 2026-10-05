// P0.09e: classifies a PR's database access changes for rule SE-6 (book phase-0.md "P0.09c", Outputs rules 1-6).
// Pure: the caller reads the files with git and passes them in; `trustedFunctions` comes from the CODEOWNERS
// `# trusted functions:` line (globs with `*`). Fails closed: anything not recognised is `trusted`, `unclassified`.
// Assumed JSON shapes until P1.12 defines them: grant-matrix.json has only the top-level keys `tables` (an object
// keyed "schema.table", each value an array of `{role, privileges, columns?, wholeTable?}`), `roles`, `schemas` and
// `pluginRule`; erasure-registry.json has only keys "<schema>.<table>.<column>". Any other key → unclassified.

import {
  classifyMatrix,
  classifyRegistry,
  isObject,
  type JsonFile,
  type Matrix,
  readMatrix,
  UNCLASSIFIED,
  type Verdict,
} from "./grant-json.ts";
import {
  Cursor,
  colKey,
  depthChange,
  hasWords,
  key,
  lineAt,
  objectsOf,
  type QName,
  type Statement,
  splitStatements,
  splitTopLevel,
  type Token,
  topLevelWord,
  unreadableAt,
} from "./grant-sql.ts";

export type ChangedPath = { path: string; status: "A" | "M" | "D" | "R" };
export type Migration = { path: string; sql: string };
export type GrantSide = { migrations: Migration[]; grantMatrix: string | null; erasureRegistry: string | null };
export type GrantInput = {
  base: GrantSide;
  head: GrantSide;
  changed: ChangedPath[];
  trustedFunctions: readonly string[];
};
export type GrantFinding = {
  path: string;
  line: number;
  kind: "trusted" | "feature" | "neutral";
  reason: string;
  statement: string;
};

const MIGRATIONS = "infrastructure/postgres/migrations/";
const MATRIX_PATH = "infrastructure/postgres/grant-matrix.json";
const REGISTRY_PATH = "infrastructure/postgres/erasure-registry.json";

// ---- Statement classification (rules 3-5) ----

type Context = {
  created: ReadonlySet<string>;
  isTrustedFunction: (q: QName) => boolean;
  legalHoldFile: boolean;
  baseMatrix: Matrix | null;
};

const NEUTRAL: Verdict = { kind: "neutral", reason: "neutral" };
const ROLE: Verdict = { kind: "trusted", reason: "role" };
const SCHEMA_GRANT: Verdict = { kind: "trusted", reason: "schema_grant" };
const DEFAULT_PRIVILEGES: Verdict = { kind: "trusted", reason: "default_privileges" };
const EXISTING_CHANGED: Verdict = { kind: "trusted", reason: "existing_function_or_view_changed" };
const TRUSTED_FUNCTION: Verdict = { kind: "trusted", reason: "trusted_function" };
const TRUSTED_FAMILY: Verdict = { kind: "trusted", reason: "trusted_family_unnamed" };
const ADD_COLUMN_EXISTING: Verdict = { kind: "trusted", reason: "existing_table_add_column" };
const onObject = (created: boolean, what: string): Verdict =>
  created
    ? { kind: "feature", reason: `created_object_${what}` }
    : { kind: "trusted", reason: `existing_object_${what}` };

const ROLE_WORDS = ["role", "user", "group"];
const FUNCTION_WORDS = ["function", "procedure", "routine"];
const NEUTRAL_CREATES = [["table"], ["unique", "index"], ["index"], ["trigger"], ["type"], ["domain"], ["sequence"]];
const NEUTRAL_VERBS = [["begin"], ["commit"], ["insert"], ["update"], ["delete"], ["comment", "on"], ["set", "role"]];
const OTHER_GRANT_TARGETS = ["database", "domain", "foreign", "language", "large", "parameter", "tablespace", "type"];
const RLS_ACTIONS = ["enable", "disable", "force", "no force"].map((w) => [
  ...w.split(" "),
  "row",
  "level",
  "security",
]);
const LEGAL_HOLD = /legal_hold/i;

/** Several verdicts for one statement: unclassified beats trusted beats feature beats neutral. */
function strongest(verdicts: Verdict[]): Verdict {
  if (verdicts.length === 0 || verdicts.some((v) => v.reason === UNCLASSIFIED.reason)) return UNCLASSIFIED;
  return verdicts.find((v) => v.kind === "trusted") ?? verdicts.find((v) => v.kind === "feature") ?? NEUTRAL;
}

/** 3e and 3f: functions on the trusted list, the unnamed families, then any not created by the PR. */
function classifyFunction(c: Cursor, stmt: Statement, ctx: Context): Verdict {
  const name = c.name();
  if (name === null || hasWords(stmt.tokens, "rename") || hasWords(stmt.tokens, "set", "schema")) return UNCLASSIFIED;
  if (ctx.isTrustedFunction(name)) return TRUSTED_FUNCTION;
  if (name.schema === "audit") return TRUSTED_FAMILY;
  const legalHold = ctx.legalHoldFile || LEGAL_HOLD.test(stmt.text);
  if (legalHold && hasWords(stmt.tokens, "security", "definer")) return TRUSTED_FAMILY;
  return ctx.created.has(key("fn", name)) ? NEUTRAL : EXISTING_CHANGED;
}

function classifyView(c: Cursor, ctx: Context): Verdict {
  c.accept("if", "not", "exists");
  c.accept("if", "exists");
  const name = c.name();
  if (name === null) return UNCLASSIFIED;
  return ctx.created.has(key("rel", name)) ? NEUTRAL : EXISTING_CHANGED;
}

function classifyPolicy(c: Cursor, ctx: Context): Verdict {
  c.accept("if", "exists");
  if (c.ident() === null || !c.accept("on")) return UNCLASSIFIED;
  const table = c.name();
  return table === null ? UNCLASSIFIED : onObject(ctx.created.has(key("rel", table)), "policy");
}

function classifyCreateSchema(c: Cursor): Verdict {
  c.accept("if", "not", "exists");
  return c.name() !== null && c.done ? NEUTRAL : UNCLASSIFIED;
}

function classifyCreate(c: Cursor, stmt: Statement, ctx: Context): Verdict {
  const orReplace = c.accept("or", "replace");
  if (ROLE_WORDS.some((w) => c.accept(w))) return ROLE;
  if (c.accept("function") || c.accept("procedure")) return classifyFunction(c, stmt, ctx);
  if (c.accept("view") || c.accept("materialized", "view") || c.accept("recursive", "view"))
    return classifyView(c, ctx);
  if (orReplace) return UNCLASSIFIED;
  if (c.accept("policy")) return classifyPolicy(c, ctx);
  // A bare CREATE SCHEMA only: AUTHORIZATION and embedded elements (which may GRANT) are not plain creates.
  if (c.accept("schema")) return classifyCreateSchema(c);
  return NEUTRAL_CREATES.some((words) => c.isWord(...words)) ? NEUTRAL : UNCLASSIFIED;
}

/** 3g: inherited grants on a new column are intended only when every base matrix entry is column-level or wholeTable. */
function addColumnVerdict(table: QName, matrix: Matrix | null): Verdict {
  const name = `${table.schema}.${table.name}`;
  const entries = matrix !== null && Object.hasOwn(matrix.tables, name) ? matrix.tables[name] : undefined;
  if (!Array.isArray(entries) || entries.length === 0) return ADD_COLUMN_EXISTING;
  const intended = entries.every(
    (e) => isObject(e) && ((Array.isArray(e.columns) && e.columns.length > 0) || e.wholeTable === true),
  );
  return intended ? NEUTRAL : ADD_COLUMN_EXISTING;
}

function classifyAlterColumn(a: Cursor): Verdict {
  a.accept("column");
  if (a.ident() === null) return UNCLASSIFIED;
  if (a.accept("set", "default")) return NEUTRAL;
  const ok = a.accept("drop", "default") || a.accept("set", "not", "null") || a.accept("drop", "not", "null");
  return ok && a.done ? NEUTRAL : UNCLASSIFIED;
}

function classifyTableAction(a: Cursor, table: QName, ctx: Context): Verdict {
  const created = ctx.created.has(key("rel", table));
  if (RLS_ACTIONS.some((words) => a.accept(...words))) return a.done ? onObject(created, "rls") : UNCLASSIFIED;
  if (a.accept("add", "column")) return created ? NEUTRAL : addColumnVerdict(table, ctx.baseMatrix);
  if (a.isWord("add", "constraint") || a.isWord("validate", "constraint") || a.isWord("drop", "column")) return NEUTRAL;
  return a.accept("alter") ? classifyAlterColumn(a) : UNCLASSIFIED; // OWNER TO and the rest: rule 5
}

function classifyAlterTable(c: Cursor, ctx: Context): Verdict {
  c.accept("if", "exists");
  c.accept("only");
  const table = c.name();
  if (table === null) return UNCLASSIFIED;
  return strongest(splitTopLevel(c.rest()).map((action) => classifyTableAction(new Cursor(action), table, ctx)));
}

function classifyAlter(c: Cursor, stmt: Statement, ctx: Context): Verdict {
  if (ROLE_WORDS.some((w) => c.accept(w))) return ROLE;
  if (c.accept("default", "privileges")) return DEFAULT_PRIVILEGES;
  if (FUNCTION_WORDS.some((w) => c.accept(w))) return classifyFunction(c, stmt, ctx);
  if (c.accept("view") || c.accept("materialized", "view")) return classifyView(c, ctx);
  if (c.accept("policy")) return classifyPolicy(c, ctx);
  return c.accept("table") ? classifyAlterTable(c, ctx) : UNCLASSIFIED;
}

function classifyDrop(c: Cursor, ctx: Context): Verdict {
  if (ROLE_WORDS.some((w) => c.accept(w))) return ROLE;
  if (c.accept("policy")) return classifyPolicy(c, ctx);
  return c.isWord("index") ? NEUTRAL : UNCLASSIFIED; // DROP TABLE, FUNCTION, VIEW: rule 5
}

/** A list of names, each optionally followed by an argument list; null when anything else is left. */
function nameList(c: Cursor): QName[] | null {
  const names: QName[] = [];
  do {
    const name = c.name();
    if (name === null) return null;
    names.push(name);
    c.parens();
  } while (c.acceptPunct(","));
  return c.done ? names : null;
}

function grantOnFunctions(c: Cursor, ctx: Context): Verdict {
  const names = nameList(c);
  if (names === null) return UNCLASSIFIED;
  if (names.some(ctx.isTrustedFunction)) return TRUSTED_FUNCTION;
  return onObject(
    names.every((n) => ctx.created.has(key("fn", n))),
    "grant",
  );
}

/** 3c: a column-list grant rides only when every listed column is new; a table-wide one only on a new relation. */
function grantOnRelations(c: Cursor, columns: string[], tableWide: boolean, ctx: Context): Verdict {
  if (!c.accept("table")) c.accept("sequence");
  const names = nameList(c);
  if (names === null) return UNCLASSIFIED;
  const created = (n: QName) =>
    columns.every((col) => ctx.created.has(colKey(n, col))) && (!tableWide || ctx.created.has(key("rel", n)));
  return onObject(names.every(created), "grant");
}

/** GRANT/REVOKE: membership (no ON) is a role statement; otherwise the target decides (3a-3c, 3f). */
function classifyGrant(tokens: readonly Token[], ctx: Context): Verdict {
  const on = topLevelWord(tokens, ["on", "to", "from"]);
  if (on < 0 || tokens[on]?.text !== "on") return ROLE;
  const target = tokens.slice(on + 1);
  const end = topLevelWord(target, ["to", "from"]);
  if (end < 0) return UNCLASSIFIED;
  const c = new Cursor(target.slice(0, end));
  const privileges = tokens.slice(1, on);
  const columns = privileges.filter((t, i) => isName(t) && isInsideParens(privileges, i)).map((t) => t.text);
  // `SELECT (c), UPDATE` grants UPDATE on the whole table: one privilege without a column list makes it table-wide.
  const tableWide = splitTopLevel(privileges).some((item) => !item.some((t) => depthChange(t) !== 0));
  if (c.isWord("schema") || c.isWord("all")) return SCHEMA_GRANT;
  if (OTHER_GRANT_TARGETS.some((w) => c.isWord(w))) return UNCLASSIFIED;
  if (FUNCTION_WORDS.some((w) => c.accept(w))) return columns.length > 0 ? UNCLASSIFIED : grantOnFunctions(c, ctx);
  return grantOnRelations(c, columns, tableWide, ctx);
}

const isName = (t: Token): boolean => t.type === "word" || t.type === "ident";
function isInsideParens(tokens: readonly Token[], index: number): boolean {
  const depth = tokens.slice(0, index + 1).reduce((d, t) => d + depthChange(t), 0);
  return depth > 0 && depthChange(tokens[index]) === 0;
}

/** SET LOCAL of a setting that cannot change how the migration's SQL is read or resolved. `search_path` (and its
 * alias `SCHEMA`) moves names; `standard_conforming_strings` changes how strings end. */
const SAFE_SET_LOCAL = ["role", "lock_timeout", "statement_timeout"];
function isSetLocal(c: Cursor): boolean {
  return c.isWord("set", "local") && SAFE_SET_LOCAL.includes(c.tokens[2]?.text ?? "");
}

function classifyStatement(stmt: Statement, ctx: Context): Verdict {
  if (stmt.unterminated) return UNCLASSIFIED;
  const c = new Cursor(stmt.tokens);
  if (c.isWord("grant") || c.isWord("revoke")) return classifyGrant(stmt.tokens, ctx);
  if (c.accept("create")) return classifyCreate(c, stmt, ctx);
  if (c.accept("alter")) return classifyAlter(c, stmt, ctx);
  if (c.accept("drop")) return classifyDrop(c, ctx);
  if (c.isWord("reset", "role")) return stmt.tokens.length === 2 ? NEUTRAL : UNCLASSIFIED;
  return NEUTRAL_VERBS.some((words) => c.isWord(...words)) || isSetLocal(c) ? NEUTRAL : UNCLASSIFIED;
}

// ---- The PR ----

function globMatcher(patterns: readonly string[]): (q: QName) => boolean {
  const toSource = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
  const res = patterns.map((p) => new RegExp(`^${toSource(p)}$`));
  return (q) => res.some((re) => re.test(`${q.schema}.${q.name}`));
}

/** The findings always name the fixed path: a decoy file of the same name elsewhere must not take them. */
const jsonFile = (input: GrantInput, field: "grantMatrix" | "erasureRegistry", path: string): JsonFile => ({
  path,
  base: input.base[field],
  head: input.head[field],
});

/** Rule 5: a changed migration that is not a new file cannot be read as a list of new statements. */
function unreadableMigrations(input: GrantInput, added: ReadonlySet<string>): GrantFinding[] {
  const known = new Set([...input.base.migrations, ...input.head.migrations].map((m) => m.path));
  return input.changed
    .filter((c) => !added.has(c.path) && (known.has(c.path) || c.path.startsWith(MIGRATIONS)))
    .map((c) => ({ path: c.path, line: 1, ...UNCLASSIFIED, statement: `(${c.status}) ${c.path}` }));
}

export function classifyGrantChanges(input: GrantInput): GrantFinding[] {
  const basePaths = new Set(input.base.migrations.map((m) => m.path));
  const changedAdded = new Set(input.changed.filter((c) => c.status === "A").map((c) => c.path));
  const newFiles = input.head.migrations.filter((m) => changedAdded.has(m.path) && !basePaths.has(m.path));
  const unreadable = newFiles
    .filter((m) => unreadableAt(m.sql) >= 0)
    .map((m) => {
      const at = unreadableAt(m.sql);
      return {
        path: m.path,
        line: lineAt(m.sql, at),
        ...UNCLASSIFIED,
        statement: JSON.stringify(m.sql.slice(at, at + 20)),
      };
    });
  const added = newFiles
    .filter((m) => unreadableAt(m.sql) < 0)
    .map((m) => ({ path: m.path, statements: splitStatements(m.sql) }));
  const baseObjects = objectsOf(input.base.migrations.flatMap((m) => splitStatements(m.sql)));
  const created = new Set([...objectsOf(added.flatMap((f) => f.statements))].filter((k) => !baseObjects.has(k)));
  const context = {
    created,
    isTrustedFunction: globMatcher(input.trustedFunctions),
    baseMatrix: readMatrix(input.base.grantMatrix),
  };
  const statementFindings = added.flatMap(({ path, statements }) =>
    statements.map((stmt): GrantFinding => {
      const verdict = classifyStatement(stmt, { ...context, legalHoldFile: /legal[-_]hold/i.test(path) });
      return { path, line: stmt.line, ...verdict, statement: stmt.text };
    }),
  );
  return [
    ...unreadableMigrations(input, new Set(newFiles.map((f) => f.path))),
    ...unreadable,
    ...statementFindings,
    ...classifyMatrix(jsonFile(input, "grantMatrix", MATRIX_PATH), created),
    ...classifyRegistry(jsonFile(input, "erasureRegistry", REGISTRY_PATH), created),
  ];
}
