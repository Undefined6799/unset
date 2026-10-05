// P0.09d: reads an AI note's header. No YAML parser is pinned and Node has none, so this is a deliberately small
// parser for the one shape docs/ai/README.md allows: one `key: value` per line, values `null`, a plain word, a
// "double-quoted" string without backslashes, or a one-line [list]. Anything outside that shape is a finding.
import type { Finding } from "./files.ts";

export type Value = string | null | string[];
export type Header = { fields: Map<string, Value>; line: Record<string, number> };

/** One header value, or why it is outside the allowed shape. Comments are refused, so nothing is silently dropped. */
function parseValue(raw: string): Value | Error {
  const text = raw.trim();
  if (text === "null") return null;
  if (/(^|\s)#/.test(text.replace(/"[^"]*"/g, '""'))) return new Error("comments are not allowed in the header");
  if (!text.startsWith("[")) return scalar(text);
  if (!text.endsWith("]")) return new Error(`unclosed list ${text}`);
  const inner = text.slice(1, -1).trim();
  if (inner === "") return [];
  const items: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    if (inner[i] === '"') quoted = !quoted;
    else if (i === inner.length || (inner[i] === "," && !quoted)) {
      items.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const values = items.map(scalar);
  return values.find((v) => v instanceof Error) ?? (values as string[]);
}

/** Plain words YAML reads as a boolean, null or number rather than text. */
const YAML_TYPED =
  /^(?:true|false|yes|no|on|off|~|[-+]?(?:\d[\d_]*)?\.?\d+(?:e[-+]?\d+)?|0x[\da-f]+|0o[0-7]+|\.inf|\.nan)$/i;

/** A quoted or plain scalar. Plain values that YAML would read differently (flow, anchors, `: `) must be quoted. */
function scalar(text: string): string | Error {
  if (text.startsWith('"')) {
    return /^"[^"\\]*"$/.test(text) ? text.slice(1, -1) : new Error(`bad quoted value ${text} (no backslashes)`);
  }
  if (text === "" || /^[[\]{}"'&*!|>%@`,?:-]/.test(text) || /:\s|"/.test(text) || YAML_TYPED.test(text)) {
    return new Error(`unsupported plain value ${text}; quote it`);
  }
  return text;
}

/** One `key: value` line, or why it cannot be read. */
function readLine(text: string, fields: readonly string[], seen: ReadonlyMap<string, Value>): [string, Value] | string {
  const m = /^([a-z_]+):(?:\s(.*))?$/.exec(text);
  if (!m) return `unreadable line: ${text}`;
  const key = m[1] ?? "";
  const value = parseValue(m[2] ?? "");
  if (value instanceof Error) return value.message;
  if (!fields.includes(key)) return `unknown field ${key}`;
  if (seen.has(key)) return `duplicate field ${key}`;
  return [key, value];
}

/** The header between the first two `---` lines with exactly `fields`, or every structural problem. */
export function readHeader(path: string, text: string, fields: readonly string[]): Header | Finding[] {
  // Obsidian accepts a byte-order mark and CRLF line ends, so the guard does too.
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  const at = (line: number, msg: string): Finding => ({ file: path, line, rule: "notes-header", text: msg });
  if (lines[0] !== "---" || end < 0) return [at(1, "no header between two --- lines")];
  const header: Header = { fields: new Map(), line: {} };
  const found: Finding[] = [];
  for (let i = 1; i < end; i++) {
    if (lines[i]?.trim() === "") continue;
    const read = readLine(lines[i] ?? "", fields, header.fields);
    if (typeof read === "string") found.push(at(i + 1, read));
    else {
      header.fields.set(...read);
      header.line[read[0]] = i + 1;
    }
  }
  for (const key of fields) if (!header.fields.has(key)) found.push(at(1, `missing field ${key}`));
  return found.length ? found : header;
}

export const linkTarget = (v: string): string | null => /^\[\[([a-z0-9][a-z0-9-]*)\]\]$/.exec(v)?.[1] ?? null;

/** Typed accessors over a header; each records a `[notes-header]` finding through `fail` when the shape is wrong. */
export function fieldReader(header: Header, fail: (key: string, msg: string) => void) {
  const str = (key: string): string => {
    const v = header.fields.get(key);
    if (typeof v !== "string") fail(key, `${key} must be a single value`);
    return typeof v === "string" ? v : "";
  };
  const list = (key: string): string[] => {
    const v = header.fields.get(key);
    if (!Array.isArray(v)) fail(key, `${key} must be a list`);
    return Array.isArray(v) ? v : [];
  };
  const links = (key: string): string[] =>
    list(key).flatMap((v) => {
      const target = linkTarget(v);
      if (!target) fail(key, `${key} entry ${v} is not "[[note-id]]"`);
      return target ? [target] : [];
    });
  /** A value from `allowed`, or "" so that rules derived from it are skipped and one fault is reported once. */
  const oneOf = (key: string, allowed: readonly string[]): string => {
    const v = str(key);
    if (!v || allowed.includes(v)) return v;
    fail(key, `${key} ${v} is not one of ${allowed.join(", ")}`);
    return "";
  };
  const date = (key: string): string => {
    const v = str(key);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
    if (v && !valid) fail(key, `${key} ${v} is not a YYYY-MM-DD date`);
    return valid ? v : "";
  };
  return { str, list, links, oneOf, date };
}
