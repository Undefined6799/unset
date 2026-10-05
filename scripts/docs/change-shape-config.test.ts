// The repository settings the P0.09c checks rely on: required checks and Renovate's commit titles. Repo config may
// ride with a check-path PR (SE-6 ruling 2026-10-05, refined 01:15Z); these tests are not checks themselves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkPrTitle } from "../guards/commit-msg.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

describe("change-shape settings", () => {
  test("required_check_listed", () => {
    const required: string[] = JSON.parse(read(".github/required-checks.json"));
    expect(required).toEqual(["check", "audit", "secrets", "actionlint", "semgrep", "pr-shape"]);
  });

  test("renovate_titles_pass", () => {
    const renovate = JSON.parse(read("renovate.json"));
    expect(renovate.commitMessagePrefix).toBe("P0.08");
    expect(renovate.commitMessageAction).toBe("Update");
    // With semantic commits on, Renovate replaces the prefix with a Conventional Commits one.
    expect(renovate.semanticCommits).toBe("disabled");
    expect(checkPrTitle("P0.08 Update dependency vitest to v5.0.3")).toEqual({ ok: true });
  });
});
