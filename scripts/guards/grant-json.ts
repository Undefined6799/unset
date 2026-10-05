// P0.09e: rule 6 of the grant classifier (grant-parse.ts): grant-matrix.json and erasure-registry.json are parsed
// on both sides of the PR, and each changed entry is `trusted` unless the PR creates its object. A file that does
// not parse, or holds a key this reader does not know, is `trusted`, `unclassified` (fail closed).

import { colKey, key, lineAt, type QName } from "./grant-sql.ts";

export type Verdict = { kind: "trusted" | "feature" | "neutral"; reason: string };
/** The same shape as grant-parse.ts's Finding, declared here so the two files do not import each other. */
type Finding = Verdict & { path: string; line: number; statement: string };
export type Matrix = { tables: Record<string, unknown>; [section: string]: unknown };
export const UNCLASSIFIED: Verdict = { kind: "trusted", reason: "unclassified" };

const MATRIX_SECTIONS: Record<string, string> = {
  roles: "matrix_roles",
  schemas: "matrix_schemas",
  pluginRule: "matrix_plugin_rule",
};

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A JSON object, `{}` for an absent file, or null when it does not parse to an object. */
function readJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function readMatrix(text: string | null): Matrix | null {
  const value = readJson(text);
  if (value === null || Object.keys(value).some((k) => k !== "tables" && !Object.hasOwn(MATRIX_SECTIONS, k)))
    return null;
  const tables = value.tables ?? {};
  return isObject(tables) ? { ...value, tables } : null;
}

function readRegistry(text: string | null): Record<string, unknown> | null {
  const value = readJson(text);
  return value !== null && Object.keys(value).every((k) => k.split(".").length === 3) ? value : null;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObject(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
}

/** Keys whose values differ between two objects (added, removed or changed). */
function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter(
    (k) => canonical(Object.hasOwn(a, k) ? a[k] : undefined) !== canonical(Object.hasOwn(b, k) ? b[k] : undefined),
  );
}

export type JsonFile = { path: string; base: string | null; head: string | null };
function jsonFinding(file: JsonFile, field: string, verdict: Verdict): Finding {
  const text = file.head ?? file.base ?? "";
  const at = text.indexOf(JSON.stringify(field));
  return { path: file.path, line: at < 0 ? 1 : lineAt(text, at), ...verdict, statement: JSON.stringify(field) };
}

const qname = (dotted: string): QName | null => {
  const [schema, name, ...rest] = dotted.split(".");
  return schema !== undefined && name !== undefined && rest.length === 0 ? { schema, name } : null;
};

export function classifyMatrix(file: JsonFile, created: ReadonlySet<string>): Finding[] {
  if (file.base === file.head) return [];
  const [base, head] = [readMatrix(file.base), readMatrix(file.head)];
  if (base === null || head === null) return [jsonFinding(file, "grant-matrix.json", UNCLASSIFIED)];
  const sections = Object.entries(MATRIX_SECTIONS)
    .filter(([section]) => canonical(base[section]) !== canonical(head[section]))
    .map(([section, reason]) => jsonFinding(file, section, { kind: "trusted", reason }));
  const tables = changedKeys(base.tables, head.tables).map((table) => {
    const q = qname(table);
    const isNew = q !== null && created.has(key("rel", q));
    return jsonFinding(
      file,
      table,
      isNew
        ? { kind: "feature", reason: "matrix_created_object" }
        : { kind: "trusted", reason: "matrix_existing_object" },
    );
  });
  return [...sections, ...tables];
}

export function classifyRegistry(file: JsonFile, created: ReadonlySet<string>): Finding[] {
  if (file.base === file.head) return [];
  const [base, head] = [readRegistry(file.base), readRegistry(file.head)];
  if (base === null || head === null) return [jsonFinding(file, "erasure-registry.json", UNCLASSIFIED)];
  return changedKeys(base, head).map((row) => {
    if (Object.hasOwn(base, row)) return jsonFinding(file, row, { kind: "trusted", reason: "registry_row_changed" });
    const [schema = "", table = "", column = ""] = row.split(".");
    const isNew = created.has(colKey({ schema, name: table }, column));
    return jsonFinding(file, row, isNew ? { kind: "feature", reason: "registry_row_created_column" } : UNCLASSIFIED);
  });
}
