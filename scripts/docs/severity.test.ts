import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { parseTriage } from "./triage.ts";

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
    expect(names).toEqual(["bug", ...SEVERITY_LABELS, "triaged", "upstream", "security-review"]);
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
    for (const id of ["what-happened", "expected", "steps", "proposed-severity", "definition-line"]) {
      expect(fields.get(id)?.validations, id).toEqual({ required: true });
    }
    const severity = fields.get("proposed-severity");
    expect(severity?.type).toBe("dropdown");
    expect(severity?.attributes.options).toEqual(SEVERITY_LABELS);

    const config = parse(read(".github/ISSUE_TEMPLATE/config.yml"));
    expect(config.blank_issues_enabled).toBe(false);
    expect(config.contact_links).toHaveLength(1);
    expect(config.contact_links[0].url).toBe("https://github.com/Undefined6799/unset/blob/main/SECURITY.md");
  });

  test("triage_form_example_parses", () => {
    expect(parseTriage(triageExample(read(SEVERITY_DOC)))).toEqual({
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
  const problems = (text: string): string[] => {
    const result = parseTriage(text);
    return result.ok ? [] : result.problems;
  };

  test("sev_3_needs_no_confirmation", () => {
    expect(parseTriage("Triage: sev-3\nMatches: everything else\nDecision: accept-for-launch").ok).toBe(true);
  });

  test("sev_1_and_sev_2_need_alex", () => {
    expect(problems("Triage: sev-1\nMatches: a secret printed\nDecision: fix")).toEqual([
      "sev-1 needs Confirmed-by: Alex YYYY-MM-DD",
    ]);
    expect(problems("Triage: sev-2\nMatches: x\nDecision: fix\nConfirmed-by: Bob 2026-10-05")).toEqual([
      "Confirmed-by must be Alex YYYY-MM-DD",
    ]);
  });

  test("downgrade_needs_test_and_alex", () => {
    expect(problems("Triage: sev-2\nMatches: x\nDecision: upstream-mitigated")).toEqual([
      "a downgrade needs Mitigation test",
      "sev-2 needs Confirmed-by: Alex YYYY-MM-DD",
    ]);
    expect(
      parseTriage(
        "Triage: sev-3\nMatches: x\nDecision: upstream-mitigated\nMitigation test: pds_rate_limit_holds\nConfirmed-by: Alex 2026-10-05",
      ).ok,
    ).toBe(true);
    expect(problems("Triage: sev-3\nMatches: x\nDecision: upstream-mitigated\nMitigation test: t")).toEqual([
      "a downgrade needs Confirmed-by: Alex YYYY-MM-DD",
    ]);
    expect(problems("Triage: sev-3\nMatches: x\nDecision: fix\nMitigation test: t")).toEqual([
      "Mitigation test is only for a downgrade",
    ]);
  });

  test("fixed_order_and_known_fields_only", () => {
    expect(problems("Matches: x\nTriage: sev-3\nDecision: fix")).toEqual(["line 1: expected Triage, found Matches"]);
    expect(problems("Triage: sev-3\nMatches: x\nDecision: fix\nNote: hi")).toEqual(["line 4: unexpected Note"]);
    expect(problems("Triage: sev-4\nMatches: x\nDecision: fix")).toEqual(["Triage must be sev-1, sev-2 or sev-3"]);
    expect(problems("Triage: sev-3\nMatches:  \nDecision: maybe")).toEqual([
      "line 2: Matches is empty",
      "Decision must be fix, accept-for-launch or upstream-mitigated",
    ]);
    expect(problems("Triage: sev-3")).toEqual(["missing Matches", "missing Decision"]);
  });

  test("confirmation_date_is_a_real_day", () => {
    expect(problems("Triage: sev-1\nMatches: x\nDecision: fix\nConfirmed-by: Alex 2026-02-30")).toEqual([
      "Confirmed-by must be Alex YYYY-MM-DD",
    ]);
  });

  test("surrounding_blank_lines_and_crlf_are_accepted", () => {
    expect(parseTriage("\r\nTriage: sev-3\r\nMatches: x\r\nDecision: fix\r\n\r\n").ok).toBe(true);
  });
});
