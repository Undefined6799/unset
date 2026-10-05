// The fixed triage comment form from docs/human/severity.md (P0.09b). The launch gate (L.02) reuses this parser,
// so a comment it accepts here is a comment the gate accepts. Two checks need the issue itself and are L.02's:
// a downgrade also needs the `upstream` label, and the comment must be the latest one in the form.

export type Severity = "sev-1" | "sev-2" | "sev-3";
export type Decision = "fix" | "accept-for-launch" | "upstream-mitigated";
export type Triage = {
  severity: Severity;
  matches: string;
  decision: Decision;
  /** Only on a downgrade: the severity the definition line gives, one level above `severity`. */
  downgradedFrom?: Severity;
  mitigationTest?: string;
  /** The day Alex confirmed, YYYY-MM-DD. */
  confirmedBy?: string;
};
export type TriageResult = { ok: true; triage: Triage } | { ok: false; problems: string[] };
/** Each severity's definition lines, normalised (see `normalise`). */
export type Definitions = ReadonlyMap<Severity, readonly string[]>;

/** The fields in their fixed order; the last three are optional. */
const FIELDS = ["Triage", "Matches", "Decision", "Downgraded-from", "Mitigation test", "Confirmed-by"] as const;
type Field = (typeof FIELDS)[number];
const REQUIRED: readonly Field[] = ["Triage", "Matches", "Decision"];
const SEVERITIES: readonly Severity[] = ["sev-1", "sev-2", "sev-3"];
const DECISIONS: readonly string[] = ["fix", "accept-for-launch", "upstream-mitigated"];
const DOWNGRADE_ONLY: readonly Field[] = ["Downgraded-from", "Mitigation test"];

/** Case, runs of spaces and a trailing list ";" or "." are not part of a definition line. */
const normalise = (line: string): string => line.trim().replace(/\s+/g, " ").replace(/[;.]$/, "").toLowerCase();

const isSeverity = (value: string | undefined): value is Severity => SEVERITIES.includes(value as Severity);

/** Reads the definition lines under "## Severity 1", "## Severity 2" and "## Severity 3" of severity.md. A bullet
 * wrapped over several lines is one definition; severity 3's one-sentence paragraph is its only line. */
export function readDefinitions(doc: string): Definitions {
  const definitions = new Map<Severity, string[]>();
  for (const severity of SEVERITIES) {
    const section = new RegExp(`^## Severity ${severity.at(-1)}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(
      doc,
    )?.[1];
    if (!section) throw new Error(`severity.md has no "## Severity ${severity.at(-1)}" section`);
    const items = section.split(/\n(?=- )/).map((item) => item.replace(/^- /, ""));
    const lines = section.includes("\n- ") ? items.slice(1) : items;
    definitions.set(
      severity,
      lines.map(normalise).filter((line) => line !== ""),
    );
  }
  return definitions;
}

/** "Alex YYYY-MM-DD" with a date that exists; returns the date or undefined. */
function confirmationDate(value: string): string | undefined {
  const date = /^Alex (\d{4}-\d{2}-\d{2})$/.exec(value)?.[1];
  if (!date) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : undefined;
}

/** Reads "Field: value" lines in the fixed order; each field at most once. */
function readFields(text: string, problems: string[]): Map<Field, string> {
  const lines = text.split(/\r\n|\r|\n/);
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
  const values = new Map<Field, string>();
  let next = 0;
  for (const [index, line] of lines.entries()) {
    const at = `line ${index + 1}`;
    const colon = line.indexOf(":");
    const name = colon === -1 ? line.trim() : line.slice(0, colon);
    const position = FIELDS.indexOf(name as Field);
    const skipped = FIELDS.slice(next, position).find((f) => REQUIRED.includes(f));
    // An order error makes every later line ambiguous, so reading stops at the first one.
    if (position === -1 || position < next) {
      problems.push(`${at}: unexpected ${name}`);
      break;
    }
    if (skipped) {
      problems.push(`${at}: expected ${skipped}, found ${name}`);
      break;
    }
    next = position + 1;
    const value = line.slice(colon + 1).trim();
    if (value === "") problems.push(`${at}: ${name} is empty`);
    values.set(name as Field, value);
  }
  return values;
}

/** Rules on each value: the allowed words, and the downgrade-only fields only on a downgrade. */
function valueProblems(values: ReadonlyMap<Field, string>): string[] {
  const problems = REQUIRED.filter((field) => !values.has(field)).map((field) => `missing ${field}`);
  const decision = values.get("Decision");
  if (values.has("Triage") && !isSeverity(values.get("Triage"))) problems.push("Triage must be sev-1, sev-2 or sev-3");
  if (decision && !DECISIONS.includes(decision)) {
    problems.push("Decision must be fix, accept-for-launch or upstream-mitigated");
  }
  const downgrade = decision === "upstream-mitigated";
  for (const field of DOWNGRADE_ONLY) {
    if (downgrade && !values.has(field)) problems.push(`a downgrade needs ${field}`);
    if (!downgrade && values.has(field)) problems.push(`${field} is only for a downgrade`);
  }
  return problems;
}

/** A downgrade drops exactly one level, never from 1 to 3, and Matches names a line of the severity it came from
 * (so the rule of doubt holds: a sev-1 line is never triaged lower without a downgrade). */
function severityProblems(values: ReadonlyMap<Field, string>, definitions: Definitions): string[] {
  const severity = values.get("Triage");
  const downgrade = values.get("Decision") === "upstream-mitigated";
  const from = downgrade ? values.get("Downgraded-from") : undefined;
  // Without a valid Triage, or a downgrade without its source, valueProblems already explains what is missing.
  if (!isSeverity(severity) || (downgrade && from === undefined)) return [];
  if (from !== undefined && from !== "sev-1" && from !== "sev-2") return ["Downgraded-from must be sev-1 or sev-2"];
  if (from !== undefined && SEVERITIES.indexOf(severity) - SEVERITIES.indexOf(from) !== 1) {
    return ["a downgrade drops exactly one level, never from 1 to 3"];
  }
  const source = from ?? severity;
  const matches = values.get("Matches");
  if (matches && !definitions.get(source)?.includes(normalise(matches))) {
    return [`Matches is not a ${source} definition line in docs/human/severity.md`];
  }
  return [];
}

/** Alex confirms every sev-1, every sev-2 and every downgrade; a confirmation names a real day. */
function confirmationProblems(values: ReadonlyMap<Field, string>): string[] {
  const severity = values.get("Triage");
  const confirmed = values.get("Confirmed-by");
  if (confirmed !== undefined) {
    return confirmationDate(confirmed) ? [] : ["Confirmed-by must be Alex YYYY-MM-DD"];
  }
  if (values.get("Decision") === "upstream-mitigated") return ["a downgrade needs Confirmed-by: Alex YYYY-MM-DD"];
  if (severity === "sev-1" || severity === "sev-2") return [`${severity} needs Confirmed-by: Alex YYYY-MM-DD`];
  return [];
}

/** Parses one triage comment against severity.md's definitions. Every problem is reported at once. */
export function parseTriage(text: string, definitions: Definitions): TriageResult {
  const problems: string[] = [];
  const values = readFields(text, problems);
  if (problems.some((p) => / (expected|unexpected) /.test(p))) return { ok: false, problems };
  problems.push(...valueProblems(values), ...severityProblems(values, definitions), ...confirmationProblems(values));
  if (problems.length > 0) return { ok: false, problems };

  const triage: Triage = {
    severity: values.get("Triage") as Severity,
    matches: values.get("Matches") as string,
    decision: values.get("Decision") as Decision,
  };
  const from = values.get("Downgraded-from");
  const mitigationTest = values.get("Mitigation test");
  const confirmed = values.get("Confirmed-by");
  if (from !== undefined) triage.downgradedFrom = from as Severity;
  if (mitigationTest !== undefined) triage.mitigationTest = mitigationTest;
  if (confirmed !== undefined) triage.confirmedBy = confirmationDate(confirmed) as string;
  return { ok: true, triage };
}
