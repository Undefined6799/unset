// P1.38y (ADR 0083): ADR front matter has one fixed format, and the index is generated from the files.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  adrFiles,
  adrIndex,
  DECISIONS,
  LEGACY_INDEX,
  legacyRows,
  parseFrontMatter,
  renderIndex,
  siteIndexProblems,
} from "./adrs.ts";
import { adrChangeProblem, adrProblems, legacyIndexProblem } from "./docs.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ADRS = new Set(["0001", "0002", "0003"]);
const SHAPE =
  "\n## Context\nWhy.\n\n## Decision\nThis.\n\n## Alternatives\n- One.\n- Two.\n\n## Consequences\nSo.\n\n## Compliance\nTest.\n";
const PROPOSED = 'status: Proposed\ndate: "2026-11-21"\nstep: P1.38y\n';
const ACCEPTED = `status: Accepted\ndate: "2026-11-21"\naccepted:\n  at: "2026-11-21T05:00Z"\n  head: 9ba2021\n  line: "accept ADR 0003 at 9ba2021"\n`;
const adr = (n: string, title: string, yaml: string | null, status = "") =>
  `${yaml === null ? "" : `---\n${yaml}---\n`}# ${n} — ${title}\n\n${status}${SHAPE}`;

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots = [];
});
/** A throwaway repository root holding only an ADR folder with these files. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "adrs-"));
  roots.push(root);
  mkdirSync(join(root, DECISIONS), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, DECISIONS, name), text);
  return root;
}
const legacy = (...rows: [string, string, string, string][]) =>
  rows.map(([adr, file, decision, status]) => `- ${JSON.stringify({ adr, file, decision, status })}\n`).join("");
const base = (extra: Record<string, string> = {}) =>
  fixture({
    [LEGACY_INDEX]: legacy(
      ["0001", "0001-log.md", "Defaults; log", "Proposed"],
      ["0002", "0002-old.md", "Old rule", "Accepted 2026-10-04"],
    ),
    "README.md": "# ADRs\n",
    "0001-log.md": "# 0001 — Log\n\n- one\n",
    "0002-old.md": adr("0002", "Old rule", null, "Status: Accepted (Alex).\n"),
    ...extra,
  });

describe("ADR front matter", () => {
  test("front_matter_valid", () => {
    expect(parseFrontMatter(PROPOSED, ADRS)).toEqual({
      value: { status: "Proposed", date: "2026-11-21", step: "P1.38y" },
      problems: [],
    });
    // yaml 2.9.1's default core schema has no timestamp type, so an unquoted date is still a string.
    expect(parseFrontMatter(PROPOSED.replace('"2026-11-21"', "2026-11-21"), ADRS).problems).toEqual([]);
    const links = `${ACCEPTED}supersedes:\n  - adr: "0002"\n    part: D8's log clause\namends:\n  - adr: "0001"\n    part: the log\n`;
    expect(parseFrontMatter(links, ADRS).problems).toEqual([]);
  });

  test("front_matter_refused", () => {
    const problems = (yaml: string) => parseFrontMatter(yaml, ADRS).problems;
    expect(problems(`${PROPOSED}owner: me\n`)).toEqual(['front matter has an unknown key "owner"']);
    expect(problems(PROPOSED.replace("Proposed", "Done"))).toEqual([
      "status is not one of Proposed, Accepted, Rejected",
    ]);
    expect(problems(PROPOSED.replace('"2026-11-21"', "today"))).toEqual(["date is not a YYYY-MM-DD"]);
    expect(problems(PROPOSED.replace("P1.38y", "step 4"))).toEqual(["step is not a step id"]);
    expect(problems(PROPOSED.replace("Proposed", "Accepted"))).toEqual([
      "accepted is set exactly when status is Accepted",
    ]);
    expect(problems(ACCEPTED.replace("Accepted", "Proposed"))).toEqual([
      "accepted is set exactly when status is Accepted",
    ]);
    expect(problems(ACCEPTED.replace("9ba2021", "main"))).toEqual(["accepted.head is not a commit"]);
    expect(problems(ACCEPTED.replace("head: 9ba2021", 'head: "1234567"\n  by: me'))).toEqual([
      'accepted has an unknown key "by"',
    ]);
    expect(problems(ACCEPTED.replace('"2026-11-21T05:00Z"', '"yesterday"'))).toEqual(["accepted.at is not a UTC time"]);
    expect(problems(`${PROPOSED}supersedes:\n  - adr: "0009"\n`)).toEqual([
      "supersedes[0].adr is not an existing ADR number",
    ]);
    expect(problems(`${PROPOSED}supersedes:\n  - adr: 2\n`)).toEqual([
      "supersedes[0].adr is not an existing ADR number",
    ]);
    expect(problems(`${PROPOSED}amends:\n  - adr: "0002"\n`)).toEqual(["amends[0].part is not text"]);
    expect(problems(`${PROPOSED}supersedes: []\n`)).toEqual(["supersedes is not a non-empty list"]);
    expect(problems("status: [")).toEqual([expect.stringMatching(/^front matter is not YAML/)]);
    expect(problems("- a\n")).toEqual(["front matter is not a mapping"]);
  });
});

describe("ADR set", () => {
  test("adr_set_clean", () => {
    expect(adrProblems(base({ "0003-new.md": adr("0003", "New rule", PROPOSED) }))).toEqual([]);
  });

  test("adr_set_refused", () => {
    const problems = (files: Record<string, string>) => adrProblems(base(files));
    expect(problems({ "0003-new.md": adr("0003", "New", null, "Status: Proposed.\n") })).toEqual([
      "0003-new.md has no front matter and no row in legacy-index.yaml (ADR 0083)",
    ]);
    expect(problems({ "0003-new.md": adr("0003", "New", PROPOSED, "Status: Proposed.\n") })).toEqual([
      "0003-new.md has a Status line as well as front matter",
    ]);
    expect(problems({ "0003-new.md": adr("0003", "New", PROPOSED.replace("Proposed", "Maybe")) })).toEqual([
      "0003-new.md: status is not one of Proposed, Accepted, Rejected",
    ]);
    expect(problems({ "0003-new.md": adr("0004", "New", PROPOSED) })).toEqual([
      '0003-new.md lacks the title "# 0003 — "',
    ]);
    expect(problems({ "0003-new.md": adr("0003", "New", PROPOSED).replace("## Alternatives\n- One.\n", "") })).toEqual([
      "0003-new.md lacks ## Alternatives",
      "0003-new.md lists fewer than two alternatives",
    ]);
    expect(problems({ "0003-a.md": adr("0003", "A", PROPOSED), "0003-b.md": adr("0003", "B", PROPOSED) })).toEqual([
      "two ADR files have the number 0003",
    ]);
    expect(problems({ notes: "x" })).toEqual(["notes is not named NNNN-title.md"]);
    expect(problems({ [LEGACY_INDEX]: '- {adr: "0002", decision: "Old rule"}\n' })).toEqual([
      "legacy-index.yaml is not a list of rows",
    ]);
    const orphan = base();
    rmSync(join(orphan, DECISIONS, "0002-old.md"));
    expect(adrProblems(orphan)).toEqual(["legacy-index.yaml row 0002 links 0002-old.md, which is not its file"]);
  });
});

describe("ADR index", () => {
  test("adr_index_derives_supersession", () => {
    const supersedes = (part?: string) =>
      `${ACCEPTED}supersedes:\n  - adr: "0002"\n${part ? `    part: ${part}\n` : ""}amends:\n  - adr: "0001"\n    part: the log\n`;
    const rows = (yaml: string) => adrIndex(base({ "0003-new.md": adr("0003", "New rule", yaml) }));
    expect(rows(supersedes())).toEqual([
      { adr: "0001", file: "0001-log.md", decision: "Defaults; log", status: "Proposed; the log amended by 0003" },
      { adr: "0002", file: "0002-old.md", decision: "Old rule", status: "Superseded by 0003" },
      { adr: "0003", file: "0003-new.md", decision: "New rule", status: "Accepted 2026-11-21" },
    ]);
    expect(rows(supersedes("Decision 2"))[1]?.status).toBe("Accepted 2026-10-04; Decision 2 superseded by 0003");
    const proposed = rows(supersedes().replace(ACCEPTED, PROPOSED));
    expect(proposed.map((r) => r.status)).toEqual(["Proposed", "Accepted 2026-10-04", "Proposed (awaiting Alex)"]);
    expect(renderIndex(proposed)).toBe(
      "| # | Decision | Status |\n| --- | --- | --- |\n| [0001](0001-log.md) | Defaults; log | Proposed |\n" +
        "| [0002](0002-old.md) | Old rule | Accepted 2026-10-04 |\n| [0003](0003-new.md) | New rule | Proposed (awaiting Alex) |\n",
    );
  });

  test("legacy_adr_keeps_its_frozen_decision_text", () => {
    // An older ADR accepted by adding front matter keeps its row's decision text, whatever its heading says.
    const rows = adrIndex(base({ "0002-old.md": adr("0002", "Old", ACCEPTED) }));
    expect(rows[1]).toEqual({ adr: "0002", file: "0002-old.md", decision: "Old rule", status: "Accepted 2026-11-21" });
  });

  test("legacy_superseded_line_shown_in_index", () => {
    // The one edit still allowed on an older accepted ADR shows in the index even with no `supersedes` in 0003.
    const superseded = adr("0002", "Old rule", null, "Status: Superseded by 0003.\n");
    const rows = adrIndex(base({ "0002-old.md": superseded, "0003-new.md": adr("0003", "New rule", PROPOSED) }));
    expect(rows[1]?.status).toBe("Superseded by 0003");
    const free = adr("0002", "Old rule", null, "Status: Superseded by 0003 (before it was accepted).\n");
    expect(adrIndex(base({ "0002-old.md": free }))[1]?.status).toBe("Accepted 2026-10-04");
  });

  test("site_index_compared_row_for_row", () => {
    const rows = adrIndex(base({ "0003-new.md": adr("0003", "New rule", PROPOSED) }));
    // Hugo's jsonify writes keys in sorted order: decision, file, status.
    const site = Object.fromEntries(rows.map((r) => [r.adr, { decision: r.decision, file: r.file, status: r.status }]));
    expect(siteIndexProblems(rows, JSON.stringify(site))).toEqual([]);
    const drifted = { ...site, "0002": { ...site["0002"], status: "Superseded by 0003" } };
    expect(siteIndexProblems(rows, JSON.stringify(drifted))).toEqual([
      expect.stringMatching(/^ADR 0002: the docs site has/),
    ]);
    const { "0003": _missing, ...short } = site;
    expect(siteIndexProblems(rows, JSON.stringify(short))).toEqual([
      expect.stringMatching(/^ADR 0003: the docs site has undefined/),
    ]);
  });

  test("adr_index_covers_the_repository", () => {
    const rows = adrIndex(ROOT);
    expect(rows.map((r) => r.file)).toEqual(adrFiles(ROOT));
    expect(rows.filter((r) => r.decision.startsWith("(no ")).map((r) => r.adr)).toEqual([]);
    // The frozen rows are the old README index, copied unchanged.
    for (const [n, row] of legacyRows(ROOT)) {
      const generated = rows.find((r) => r.adr === n);
      expect(generated?.decision).toBe(row.decision);
    }
  });
});

describe("ADR immutability after the cut-over", () => {
  test("front_matter_adr_fixed_once_accepted", () => {
    const accepted = adr("0003", "New", ACCEPTED);
    const change = (before: string, after: string | null) => adrChangeProblem("0003-new.md", before, after, ADRS);
    expect(change(accepted, accepted.replace("Why.", "Why not."))).toMatch(/accepted or rejected ADR may not change/);
    expect(change(accepted, accepted.replace("9ba2021", "1234567"))).toMatch(/may not change/);
    expect(change(accepted, null)).toMatch(/may not change/);
    const rejected = adr("0003", "New", 'status: Rejected\ndate: "2026-11-21"\n');
    expect(change(rejected, rejected.replace("Why.", "Why not."))).toMatch(/may not change/);
    const quoted = accepted.replace("status: Accepted", 'status: "Accepted"');
    expect(change(quoted, quoted.replace("Why.", "Why not."))).toMatch(/may not change/);
    const proposed = adr("0003", "New", PROPOSED);
    expect(change(proposed, accepted)).toBe(null);
    expect(change(proposed, proposed.replace("Why.", "Why not."))).toBe(null);
  });

  test("log_closed_once_legacy_index_exists", () => {
    const log = "# 0001 — Log\n\n- one\n";
    expect(adrChangeProblem("0001-log.md", log, `${log}- two\n`, ADRS)).toBe(null);
    expect(adrChangeProblem("0001-log.md", log, `${log}- two\n`, ADRS, true)).toMatch(/ADR 0001's log is closed/);
    expect(adrChangeProblem("0001-log.md", log, log, ADRS, true)).toBe(null);
  });

  test("legacy_index_frozen", () => {
    const rows = legacy(["0002", "0002-old.md", "Old rule", "Accepted"]);
    expect(legacyIndexProblem(null, rows)).toBe(null); // the cut-over adds it
    expect(legacyIndexProblem(rows, rows)).toBe(null);
    expect(legacyIndexProblem(rows, rows.replace("Accepted", "Superseded"))).toMatch(/may not change/);
    expect(legacyIndexProblem(rows, null)).toMatch(/may not change/);
  });
});
