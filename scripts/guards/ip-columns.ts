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

/** Columns are attributed to the nearest preceding CREATE TABLE / ALTER TABLE. */
function scanMigration(file: string, source: string, allow: ReadonlySet<string>, seen: Set<string>): Finding[] {
  const findings: Finding[] = [];
  let table = "";
  source.split("\n").forEach((raw, i) => {
    let text = raw.replace(/--.*$/, "");
    const header = TABLE_HEADER.exec(text);
    if (header) {
      table = normalise(header[1] ?? "");
      seen.add(table);
      text = text.replace(header[0], " "); // The table's own name is not a column.
    }
    const named = (text.match(/[A-Za-z_][\w$]*/g) ?? []).some((t) => ADDRESS_NAME.test(t.toLowerCase()));
    if ((ADDRESS_TYPE.test(text) || named) && !allow.has(table)) {
      findings.push({ file, line: i + 1, rule: RULE, text: raw });
    }
  });
  return findings;
}

/** Every entry needs a step id and a reason, and must name a table some migration declares. */
function checkAllowList(entries: readonly AllowEntry[], seen: ReadonlySet<string>): Finding[] {
  return entries.flatMap((entry, i) => {
    const problem = !STEP_ID.test(entry.step ?? "")
      ? "unknown step id"
      : !entry.reason?.trim()
        ? "empty reason"
        : !seen.has(normalise(entry.table ?? ""))
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
  const allow = new Set(allowList.map((e) => normalise(e.table ?? "")));
  const seen = new Set<string>();
  const migrations = filesUnder(root, SCANNED_DIRS, /\.sql$/).filter((f) => /(^|\/)migrations\//.test(f));
  const findings = scanFiles(root, migrations, RULE, (file, source) => scanMigration(file, source, allow, seen));
  return [...findings, ...checkAllowList(allowList, seen)];
}
