import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { parseTriage, readDefinitions } from "./triage.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const SEVERITY_DOC = "docs/human/severity.md";
const SEVERITY_LABELS = ["sev-1", "sev-2", "sev-3"];

/** The fenced `text` block after the "Example:" line of the triage section. */
function triageExample(doc: string): string {
  const match = /^Example:\n\n```text\n([\s\S]*?)\n```$/m.exec(doc);
  if (!match?.[1]) throw new Error("no triage example in severity.md");
  return match[1];
}

describe("severity definitions and labels", () => {
  test("severity_doc_complete", () => {
    const doc = read(SEVERITY_DOC);
    expect(doc).toMatch(/^Status: confirmed by Alex 2026-10-03 \(P5-A5 = L-A1\)\.$/m);
    expect(doc).not.toMatch(/draft/i);
    for (const heading of [
      "Severity 1",
      "Severity 2",
      "Severity 3",
      "Rule of doubt",
      "Upstream-mitigation downgrade",
      "Triage comment",
    ]) {
      expect(doc).toContain(`\n## ${heading}\n`);
    }
    expect(doc).toContain("never from 1 to 3");
  });

  test("labels_listed", () => {
    const labels: { name: string; description: string; color: string }[] = JSON.parse(read(".github/labels.json"));
    const names = labels.map((l) => l.name);
    expect(names).toEqual([
      "bug",
      ...SEVERITY_LABELS,
      "triaged",
      "upstream",
      "security-review",
      // P0.09c: the PR size override and the kind of change (D2, D3).
      "large-pr",
      "kind/feature",
      "kind/fix",
      "kind/refactor",
      "kind/docs",
      "kind/build",
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const label of labels) {
      expect(label.description.trim(), label.name).not.toBe("");
      // GitHub caps label descriptions at 100 characters.
      expect(label.description.length, label.name).toBeLessThanOrEqual(100);
      expect(label.color, label.name).toMatch(/^[0-9a-f]{6}$/);
    }
  });

  test("bug_template_fields", () => {
    const form = parse(read(".github/ISSUE_TEMPLATE/bug.yml"));
    expect(form.labels).toEqual(["bug"]);
    const fields = new Map<string, { type: string; attributes: { options?: string[] }; validations?: object }>(
      form.body.filter((f: { id?: string }) => f.id).map((f: { id: string }) => [f.id, f]),
    );
    expect(form.name).toBe("Bug");
    expect(form.description).toMatch(/SECURITY\.md/);
    const types = {
      "what-happened": "textarea",
      expected: "textarea",
      steps: "textarea",
      "proposed-severity": "dropdown",
      "definition-line": "input",
    };
    expect([...fields.keys()]).toEqual(Object.keys(types));
    for (const [id, type] of Object.entries(types)) {
      expect(fields.get(id)?.type, id).toBe(type);
      // GitHub enforces this only on public repositories; severity.md says triage checks for empty answers.
      expect(fields.get(id)?.validations, id).toEqual({ required: true });
    }
    const severity = fields.get("proposed-severity");
    expect(severity?.type).toBe("dropdown");
    expect(severity?.attributes.options).toEqual(SEVERITY_LABELS);

    const config = parse(read(".github/ISSUE_TEMPLATE/config.yml"));
    expect(config.blank_issues_enabled).toBe(false);
    expect(config.contact_links).toHaveLength(1);
    expect(config.contact_links[0].url).toBe("https://github.com/Undefined6799/unset/blob/main/.github/SECURITY.md");
  });

  test("triage_form_example_parses", () => {
    const doc = read(SEVERITY_DOC);
    expect(parseTriage(triageExample(doc), readDefinitions(doc))).toEqual({
      ok: true,
      triage: {
        severity: "sev-2",
        matches: "a core feature wrong for some users with no reasonable workaround",
        decision: "fix",
        confirmedBy: "2026-10-05",
      },
    });
  });
});

describe("triage comment parser", () => {
  const definitions = readDefinitions(read(SEVERITY_DOC));
  const S1 = "a core flow broken for all users";
  const S2 = "a core feature wrong for some users with no reasonable workaround";
  const S3 = "Everything else";
  const parseIt = (text: string) => parseTriage(text, definitions);
  const problems = (text: string): string[] => {
    const result = parseIt(text);
    return result.ok ? [] : result.problems;
  };

  test("definitions_read_from_severity_doc", () => {
    expect(definitions.get("sev-1")).toHaveLength(6);
    expect(definitions.get("sev-2")).toHaveLength(7);
    expect(definitions.get("sev-3")).toEqual(["everything else"]);
    // A wrapped bullet is one definition.
    expect(definitions.get("sev-1")).toContain(
      "a legal-duty failure: the abuse-material check, report or preservation path does not work, or erasure or export does not work",
    );
  });

  test("sev_3_needs_no_confirmation", () => {
    expect(parseIt(`Triage: sev-3\nMatches: ${S3}\nDecision: accept-for-launch`).ok).toBe(true);
  });

  test("sev_1_and_sev_2_need_alex", () => {
    expect(problems(`Triage: sev-1\nMatches: ${S1}\nDecision: fix`)).toEqual([
      "sev-1 needs Confirmed-by: Alex YYYY-MM-DD",
    ]);
    expect(problems(`Triage: sev-2\nMatches: ${S2}\nDecision: fix\nConfirmed-by: Bob 2026-10-05`)).toEqual([
      "Confirmed-by must be Alex YYYY-MM-DD",
    ]);
  });

  test("matches_a_definition_of_its_severity", () => {
    // The rule of doubt: a sev-1 line cannot be triaged lower without a downgrade.
    expect(problems(`Triage: sev-3\nMatches: ${S1}\nDecision: fix`)).toEqual([
      "Matches is not a sev-3 definition line in docs/human/severity.md",
    ]);
    expect(problems("Triage: sev-3\nMatches: whatever I want\nDecision: fix")).toEqual([
      "Matches is not a sev-3 definition line in docs/human/severity.md",
    ]);
    // Case, spacing and the list punctuation are not part of the line.
    expect(
      parseIt(
        `Triage: sev-2\nMatches:  A core feature wrong for some users  with no reasonable workaround;\nDecision: fix\nConfirmed-by: Alex 2026-10-05`,
      ).ok,
    ).toBe(true);
  });

  test("downgrade_drops_one_level_with_test_and_alex", () => {
    const down = (from: string, to: string, matches: string) =>
      `Triage: ${to}\nMatches: ${matches}\nDecision: upstream-mitigated\nDowngraded-from: ${from}\nMitigation test: pds_rate_limit_holds\nConfirmed-by: Alex 2026-10-05`;
    expect(parseIt(down("sev-2", "sev-3", S2))).toEqual({
      ok: true,
      triage: {
        severity: "sev-3",
        matches: S2,
        decision: "upstream-mitigated",
        downgradedFrom: "sev-2",
        mitigationTest: "pds_rate_limit_holds",
        confirmedBy: "2026-10-05",
      },
    });
    expect(parseIt(down("sev-1", "sev-2", S1)).ok).toBe(true);
    // Never from 1 to 3, and never more or less than one level.
    expect(problems(down("sev-1", "sev-3", S1))).toEqual(["a downgrade drops exactly one level, never from 1 to 3"]);
    expect(problems(down("sev-2", "sev-2", S2))).toEqual(["a downgrade drops exactly one level, never from 1 to 3"]);
    expect(problems(down("sev-3", "sev-1", S3))).toEqual(["Downgraded-from must be sev-1 or sev-2"]);
    // Matches names the line of the severity before the downgrade.
    expect(problems(down("sev-2", "sev-3", S3))).toEqual([
      "Matches is not a sev-2 definition line in docs/human/severity.md",
    ]);
  });

  test("downgrade_needs_every_field", () => {
    expect(problems(`Triage: sev-3\nMatches: ${S2}\nDecision: upstream-mitigated`)).toEqual([
      "a downgrade needs Downgraded-from",
      "a downgrade needs Mitigation test",
      "a downgrade needs Confirmed-by: Alex YYYY-MM-DD",
    ]);
    expect(
      problems(`Triage: sev-3\nMatches: ${S3}\nDecision: fix\nDowngraded-from: sev-2\nMitigation test: t`),
    ).toEqual(["Downgraded-from is only for a downgrade", "Mitigation test is only for a downgrade"]);
  });

  test("fixed_order_and_known_fields_only", () => {
    expect(problems(`Matches: ${S3}\nTriage: sev-3\nDecision: fix`)).toEqual([
      "line 1: expected Triage, found Matches",
    ]);
    expect(problems(`Triage: sev-3\nMatches: ${S3}\nDecision: fix\nNote: hi`)).toEqual(["line 4: unexpected Note"]);
    expect(problems(`Triage: sev-3\nTriage: sev-3\nMatches: ${S3}\nDecision: fix`)).toEqual([
      "line 2: unexpected Triage",
    ]);
    expect(problems(`triage: sev-3\nMatches: ${S3}\nDecision: fix`)).toEqual(["line 1: unexpected triage"]);
    expect(problems(`Triage: sev-4\nMatches: ${S3}\nDecision: fix`)).toEqual(["Triage must be sev-1, sev-2 or sev-3"]);
    expect(problems("Triage: sev-3\nMatches:  \nDecision: maybe")).toEqual([
      "line 2: Matches is empty",
      "Decision must be fix, accept-for-launch or upstream-mitigated",
    ]);
    expect(problems("Triage: sev-3")).toEqual(["missing Matches", "missing Decision"]);
  });

  test("confirmation_date_is_a_real_day", () => {
    expect(problems(`Triage: sev-1\nMatches: ${S1}\nDecision: fix\nConfirmed-by: Alex 2026-02-30`)).toEqual([
      "Confirmed-by must be Alex YYYY-MM-DD",
    ]);
  });

  test("blank_lines_and_any_line_ending_are_accepted", () => {
    expect(parseIt(`\r\nTriage: sev-3\r\nMatches: ${S3}\r\nDecision: fix\r\n\r\n`).ok).toBe(true);
    expect(parseIt(`Triage: sev-3\rMatches: ${S3}\rDecision: fix`).ok).toBe(true);
  });
});
