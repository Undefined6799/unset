// P0.09: the repository's documents say what the book and the rules require, and each check fails on a planted defect.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  AI_NOTES_LINE,
  adrChangeProblem,
  adrImmutableProblems,
  adrProblems,
  architectureRows,
  architectureTableProblems,
  bookSnapshotProblems,
  claudeMdImportProblems,
  claudeMdProblems,
  glossaryProblems,
  type KnownChecks,
  PR_TEMPLATE_HEADINGS,
  prTemplateProblems,
  securityMdProblems,
  TOP15_IMPORT,
  testNames,
  top15Problems,
} from "./docs.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const claudeMd = read("CLAUDE.md");

describe("CLAUDE.md", () => {
  test("claude_md_short", () => {
    expect(claudeMdProblems(claudeMd)).toEqual([]);
    expect(claudeMdProblems(`${claudeMd}${"x\n".repeat(120)}`)).toEqual([
      expect.stringMatching(/^CLAUDE\.md has \d+ lines/),
    ]);
    expect(claudeMdProblems(claudeMd.replaceAll("docs/ai/book/", "docs/ai/other/"))).toContain(
      "CLAUDE.md does not name docs/ai/book/",
    );
  });

  test("claude_md_rules_import", () => {
    expect(claudeMdImportProblems(ROOT, claudeMd)).toEqual([]);
    expect(claudeMdImportProblems(ROOT, claudeMd.replace(`${TOP15_IMPORT}\n`, ""))).toHaveLength(1);
    const full = claudeMd.replace(TOP15_IMPORT, "@docs/human/engineering/engineering-rules.md");
    expect(claudeMdImportProblems(ROOT, full)).toHaveLength(1);
    expect(claudeMdImportProblems(ROOT, `${claudeMd}@docs/human/missing.md\n`)).toHaveLength(2);
    expect(top15Problems(ROOT)).toEqual([]);
    expect(claudeMdProblems(claudeMd.replace(`${TOP15_IMPORT}\n`, ""))).toContain(
      `CLAUDE.md lacks the import ${TOP15_IMPORT}`,
    );
    const noPrecedence = claudeMd.replace(/the plan\s+wins/, "the plan is read first");
    expect(claudeMdProblems(noPrecedence)).toEqual([expect.stringMatching(/precedence rule/)]);
    expect(claudeMdProblems(claudeMd.replace("**D1 Functions:**", "**D10 Functions:**"))).toEqual([
      "Delivery does not mention D1",
    ]);
    expect(claudeMdProblems(claudeMd.replace("**D8 Decisions:**", "**Decisions:**"))).toEqual([
      "Delivery does not mention D8",
    ]);
  });

  test("claude_md_agents_never_merge", () => {
    expect(claudeMdProblems(claudeMd.replace("never merge them", "merge them"))).toEqual([
      "Delivery does not say agents never merge",
    ]);
    expect(claudeMdProblems(claudeMd.replace("never push to\n  `main`", "push to `main`"))).toEqual([
      "Delivery does not say agents never push to `main`",
    ]);
    expect(claudeMdProblems(claudeMd.replace("ADR 0009", "ADR 0008"))).toEqual(["Delivery does not name ADR 0009"]);
  });

  test("v2e_superseded", () => {
    expect(claudeMdProblems(`${claudeMd}- Use iconoir-react for icons.\n`)).toHaveLength(1);
    expect(claudeMdProblems(`${claudeMd}- Amber accent on primary buttons.\n`)).toHaveLength(1);
    expect(claudeMdProblems(`${claudeMd}- Buttons are chamfered.\n`)).toHaveLength(1);
    expect(claudeMdProblems(`${claudeMd}- Icons come from \`iconoir-react\`.\n`)).toHaveLength(1);
    expect(claudeMdProblems(`${claudeMd}- Use the v2e tokens.\n`)).toHaveLength(1);
    expect(claudeMdProblems(`${claudeMd}- Display serif headings.\n`)).toHaveLength(1);
    expect(claudeMdProblems(claudeMd.replace("is **superseded**", "is not **superseded**"))).toHaveLength(2);
    expect(claudeMdProblems(claudeMd.replace("**superseded**", "**current**"))).toContain(
      "CLAUDE.md does not name v2e-visual-direction-locked as superseded",
    );
    expect(claudeMdProblems(claudeMd.replace("Iconoir 7.12.1", "Iconoir"))).toContain(
      "CLAUDE.md lacks the Iconoir line (7.12.1, shared/ui Icon, no icon packages)",
    );
  });
});

describe("ADRs", () => {
  test("adr_index_complete", () => {
    expect(adrProblems(ROOT)).toEqual([]);
  });

  test("adr_immutable", () => {
    const base = "origin/main";
    // Fails closed: without the base branch there is nothing to compare against (CI fetches full history).
    expect(() => execFileSync("git", ["rev-parse", "--verify", base], { cwd: ROOT, stdio: "ignore" })).not.toThrow();
    expect(adrImmutableProblems(ROOT, base)).toEqual([]);

    const adrs = new Set(["0009", "0012"]);
    const change = (before: string, after: string | null, file = "0009-x.md") =>
      adrChangeProblem(file, before, after, adrs);
    const accepted = "# 0009 — X\n\nStatus: accepted (Alex).\n\n## Context\nWhy.\n";
    const supersede = (to: string) => accepted.replace("Status: accepted (Alex).", to);
    expect(change(accepted, supersede("Status: Superseded by 0012."))).toBe(null);
    expect(change(accepted, supersede("Status: Superseded by 0013."))).toMatch(/may only change/);
    expect(change(accepted, supersede("Status: Superseded by 0012; also X is allowed."))).toMatch(/may only change/);
    expect(change(accepted, accepted.replace("Why.", "Why not."))).toMatch(/may only change/);
    const bold = accepted.replace("accepted", "**Accepted**");
    expect(change(bold, bold.replace("Why.", "Why not."))).toMatch(/may only change/);
    expect(change(accepted, null)).toMatch(/deleted or renamed/);
    const log = "# 0001 — Log\n\n- one\n- two\n";
    expect(change(log, `${log}- three\n`, "0001-log.md")).toBe(null);
    expect(change(log, log.replace("- one", "- uno"), "0001-log.md")).toMatch(/only gain lines/);
    expect(change(log, log.replace("- two\n", "- two, reversed\n"), "0001-log.md")).toMatch(/only gain lines/);
    expect(change(log, null, "0001-log.md")).toMatch(/only gain lines/);
  });
});

describe("other documents", () => {
  test("security_md_scope", () => {
    expect(securityMdProblems(read("SECURITY.md"))).toEqual([]);
    expect(securityMdProblems(read("SECURITY.md").replace("`chat-admin`", "chat admin"))).toEqual([
      "SECURITY.md does not name `chat-admin`",
    ]);
  });

  test("pr_template_headings", () => {
    const template = read(".github/pull_request_template.md");
    expect(prTemplateProblems(template)).toEqual([]);
    expect(prTemplateProblems(template.replace("## Threats\n", ""))).toHaveLength(1);
    expect(
      prTemplateProblems(template.replace("## Step\n", "").replace("## What\n", "## What\n\n## Step\n")),
    ).toHaveLength(1);
    expect(prTemplateProblems(template.replace(AI_NOTES_LINE, "AI notes:"))).toHaveLength(1);
    expect(PR_TEMPLATE_HEADINGS).toHaveLength(16);
  });

  test("glossary_canonical", () => {
    const glossary = read("docs/human/glossary.md");
    const pointer = read("docs/ai/book/03-glossary.md");
    expect(glossaryProblems(glossary, pointer)).toEqual([]);
    expect(glossaryProblems(`${glossary}| **DID** | Again. |\n`, pointer)).toEqual(["glossary word DID appears twice"]);
    expect(glossaryProblems(`${glossary}| **did** | Again. |\n`, pointer)).toEqual(["glossary word did appears twice"]);
    expect(glossaryProblems(glossary, `${pointer}\n\nMore.\n`)).toHaveLength(1);
  });

  test("book_snapshot_marked", () => {
    expect(bookSnapshotProblems(read("docs/ai/book/README.md"))).toEqual([]);
    expect(bookSnapshotProblems("# Book\n\nA copy.\n")).toHaveLength(3);
    expect(bookSnapshotProblems("From unset-plan/breakdown/, review round, 2026-10-04.")).toEqual([
      "docs/ai/book/README.md names no round",
    ]);
  });
});

describe("architecture rule table", () => {
  /** The checks that exist: config rules, test names, and test or guard files the table names. */
  const knownChecks = (rows: ReturnType<typeof architectureRows>): KnownChecks => {
    const config = createRequire(import.meta.url)(join(ROOT, ".dependency-cruiser.cjs")) as {
      forbidden: { name: string }[];
    };
    const subjects = execFileSync("git", ["log", "--format=%s", "origin/main"], { cwd: ROOT, encoding: "utf8" });
    const paths = rows.flatMap((r) => [...r.checkedBy.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? ""));
    const isGuardFile = (p: string) => /^(scripts|tests)\/[\w./-]+\.ts$/.test(p) && existsSync(join(ROOT, p));
    return {
      forbidden: new Set(config.forbidden.map((r) => r.name)),
      tests: testNames(ROOT, ["scripts", "tests", "apps", "interfaces", "domains", "infrastructure", "shared"]),
      files: new Set(paths.filter(isGuardFile)),
      mergedSteps: new Set([...subjects.matchAll(/^(P\d+\.\d+[a-z]?) /gm)].map((m) => m[1] ?? "")),
    };
  };

  test("architecture_rule_table_matches_depcruise", () => {
    const rows = architectureRows(read("docs/human/architecture.md"));
    const known = knownChecks(rows);
    expect(known.forbidden.size).toBeGreaterThan(0);
    expect(architectureTableProblems(rows, known)).toEqual([]);

    const first = [...known.forbidden][0] ?? "";
    const row = (rule: string, checkedBy: string) => ({ rule, checkedBy });
    const all = [row("AB-1", "checked: `MATRIX`"), ...[...known.forbidden].map((n) => row("X", `checked: \`${n}\``))];
    expect(architectureTableProblems(all, known)).toEqual([]);
    expect(architectureTableProblems([...all, row("Y", "checked: `no-such-rule`")], known)).toEqual([
      "Y: names `no-such-rule`, which does not exist",
    ]);
    expect(
      architectureTableProblems(
        all.filter((r) => r.checkedBy !== `checked: \`${first}\``),
        known,
      ),
    ).toEqual([`config rule ${first} has no row`]);
    expect(architectureTableProblems([...all, row("Z", "review-only: ")], known)).toEqual([
      "Z: review-only without a reason",
    ]);
    expect(architectureTableProblems([...all, row("W", "planned: P0.05")], known)).toEqual([
      "W: P0.05 has merged but the row still says planned",
    ]);
    expect(architectureTableProblems([...all, row("V", "planned: P9.99")], known)).toEqual([]);
    expect(architectureTableProblems([...all, row("V", "planned: P9.99 (a test)")], known)).toEqual([
      'V: "Checked by" is neither checked, planned nor review-only',
    ]);
    expect(architectureTableProblems([...all, row("U", "checked: `README.md`")], known)).toHaveLength(1);
    expect(architectureTableProblems([], known)).toEqual(["the architecture rule table has no rows"]);
  });
});
