// Guard: no column stores a client address or user agent (global invariant 3; "no IP written", P3.17, P4.03, P4.07).
// Lexical on schema only: it reads SQL migrations. Exceptions live in ip-columns.allow.json, one reasoned entry per
// table, added by the step that owns it. No guard-allow.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Finding, filesUnder, scanFiles } from "./files.ts";

export const SCANNED_DIRS = ["."] as const;
const RULE = "ip-columns";
export const ALLOW_FILE = "scripts/guards/ip-columns.allow.json";

export type AllowEntry = { table: string; step: string; reason: string };

const ADDRESS_TYPE = /\b(inet|cidr|macaddr8?)\b/i;
const ADDRESS_NAME = /(^|_)(ip|ipv4|ipv6|ip_addr|ip_address|remote_addr|client_addr|client_ip|user_agent|ua)($|_)/;
const TABLE_HEADER =
  /\b(?:create\s+(?:(?:unlogged|temp|temporary)\s+)?table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+if\s+exists)?(?:\s+only)?)\s+("?[\w$]+"?(?:\."?[\w$]+"?)?)/i;
const STEP_ID = /^P\d+\.\d+[a-z]?$/;

const normalise = (table: string): string => table.replaceAll('"', "").toLowerCase();

/** Drops `--` comments and the contents of string literals, so neither hides nor invents a column. */
function codeOnly(line: string): string {
  return line.replace(/'(?:[^']|'')*'|--.*$/g, (m) => (m.startsWith("--") ? "" : "''"));
}

function mentionsAddress(text: string): boolean {
  const named = (text.match(/[A-Za-z_][\w$]*/g) ?? []).some((t) => ADDRESS_NAME.test(t.toLowerCase()));
  return named || ADDRESS_TYPE.test(text);
}

/** Columns are attributed to the nearest preceding CREATE TABLE / ALTER TABLE, statement by statement. */
function scanMigration(file: string, source: string, allow: ReadonlySet<string>, seen: Set<string>): Finding[] {
  const findings: Finding[] = [];
  let table = "";
  source.split("\n").forEach((raw, i) => {
    let hit = false;
    for (let text of codeOnly(raw).split(";")) {
      const header = TABLE_HEADER.exec(text);
      if (header) {
        table = normalise(header[1] ?? "");
        seen.add(table);
        text = text.replace(header[0], " "); // The table's own name is not a column.
      }
      if (mentionsAddress(text) && !allow.has(table)) hit = true;
    }
    if (hit) findings.push({ file, line: i + 1, rule: RULE, text: raw });
  });
  return findings;
}

const isEntry = (e: unknown): e is AllowEntry =>
  typeof e === "object" &&
  e !== null &&
  ["table", "step", "reason"].every((k) => typeof (e as Record<string, unknown>)[k] === "string");

/** Every entry needs a step id and a reason, and must name a table some migration declares. */
function checkAllowList(entries: readonly unknown[], seen: ReadonlySet<string>): Finding[] {
  return entries.flatMap((entry, i) => {
    if (!isEntry(entry))
      return [{ file: ALLOW_FILE, line: i + 1, rule: RULE, text: "entry needs table, step and reason" }];
    const problem = !STEP_ID.test(entry.step)
      ? "unknown step id"
      : !entry.reason.trim()
        ? "empty reason"
        : !seen.has(normalise(entry.table))
          ? "no migration declares this table"
          : "";
    return problem ? [{ file: ALLOW_FILE, line: i + 1, rule: RULE, text: `${entry.table}: ${problem}` }] : [];
  });
}

/** A missing allow file means no exemptions; an unparsable one is a finding. */
function readAllowList(root: string): AllowEntry[] | Finding {
  const path = join(root, ALLOW_FILE);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) return parsed as AllowEntry[];
  } catch {
    // Reported below.
  }
  return { file: ALLOW_FILE, line: 1, rule: RULE, text: "not a JSON array" };
}

export function scanAll(root: string, allowList: readonly AllowEntry[] | Finding = readAllowList(root)): Finding[] {
  if (!Array.isArray(allowList)) return [allowList as Finding];
  // Only a complete, reasoned entry exempts its table.
  const allow = new Set(allowList.filter((e) => isEntry(e) && e.reason.trim()).map((e) => normalise(e.table)));
  const seen = new Set<string>();
  const migrations = filesUnder(root, SCANNED_DIRS, /\.sql$/).filter((f) => /(^|\/)migrations\//.test(f));
  const findings = scanFiles(root, migrations, RULE, (file, source) => scanMigration(file, source, allow, seen));
  return [...findings, ...checkAllowList(allowList, seen)];
}
