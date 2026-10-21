import { describe, expect, test } from "vitest";
import { verdictFromStatus } from "./docs-only.ts";
import { docsOnlyRejection, parseNameStatus, pathAllowed } from "./docs-only-paths.ts";

const allowed = [
  "README.md",
  "docs/human/architecture.md",
  "docs/human/evidence/0017-main-ruleset/read-back.md",
  "docs/human/decisions.md",
  "docs/site/index.md",
  "docs/ai/notes/pitfall/example.md",
  "docs/ai/notes/area/ci.md",
];

const denied = [
  "CLAUDE.md",
  "AGENTS.md",
  "docs/ai/PLAN.md",
  "docs/ai/README.md",
  "docs/ai/book/phase-0.md",
  "docs/ai/book/01-outline.md",
  "docs/human/decisions/0034-docs-only-auto-merge.md",
  "docs/human/decisions",
  "docs/human/Decisions/0001.md",
  "docs/human/DECISIONS/note.md",
  ".github/workflows/ci.yml",
  ".github/workflows/docs-only.yml",
  "scripts/guards/docs-only-paths.ts",
  "scripts/ci/secrets-fixtures.ts",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "shared/lexicons/scripts/build.ts",
  "shared/lexicons/generated/index.ts",
  "readme.md",
  "docs/site",
  "docs/ai/notes",
  "docs/human/../../CLAUDE.md",
  "docs/site/../../package.json",
  "/README.md",
  "docs\\human\\a.md",
  "docs/human//a.md",
  "",
];

describe("docs-only allowlist", () => {
  test("allowed_paths", () => {
    for (const path of allowed) expect(pathAllowed(path), path).toBe(true);
  });

  test("denied_paths", () => {
    for (const path of denied) expect(pathAllowed(path), path).toBe(false);
  });

  test("empty_list_fails", () => {
    expect(docsOnlyRejection([])).toBe("empty file list");
  });

  test("rename_requires_both_paths", () => {
    expect(docsOnlyRejection([{ path: "docs/human/b.md", previous: "docs/human/a.md" }])).toBeNull();
    expect(docsOnlyRejection([{ path: "docs/human/b.md", previous: "CLAUDE.md" }])).toBe("CLAUDE.md");
    expect(docsOnlyRejection([{ path: "package.json", previous: "docs/human/a.md" }])).toBe("package.json");
  });

  test("deletion_uses_the_deleted_path", () => {
    expect(docsOnlyRejection([{ path: "docs/site/old.md" }])).toBeNull();
    expect(docsOnlyRejection([{ path: "package-lock.json" }])).toBe("package-lock.json");
  });

  test("name_status_parses_renames_and_deletions", () => {
    const status = "R100\0docs/human/a.md\0docs/human/b.md\0D\0docs/site/old.md\0M\0README.md\0";
    expect(parseNameStatus(status)).toEqual([
      { path: "docs/human/b.md", previous: "docs/human/a.md" },
      { path: "docs/site/old.md" },
      { path: "README.md" },
    ]);
    expect(verdictFromStatus(status)).toBe(0);
  });

  test("name_status_fails_closed", () => {
    expect(verdictFromStatus("")).toBe(1);
    expect(verdictFromStatus("M\0CLAUDE.md\0")).toBe(1);
    expect(verdictFromStatus("R090\0AGENTS.md\0docs/human/a.md\0")).toBe(1);
    expect(() => parseNameStatus("U\0conflict.md\0")).toThrow(/unknown git status/);
    expect(() => parseNameStatus("R100\0only-old\0")).toThrow(/truncated rename/);
    expect(() => parseNameStatus("M\0")).toThrow(/truncated path/);
  });
});
