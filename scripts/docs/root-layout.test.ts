// P0.09g: the repository root holds only what must live there. Eight config and check files moved to .github/ and
// scripts/ (Alex, "Move the nine", 2026-10-05); nothing that runs or documents the repository may name the old place.
// .semgrepignore stays: Semgrep 1.178.0 scanned 211 files with it and 208 with the same --exclude flags, because
// without an ignore file Semgrep applies its own default ignores (it dropped scripts/test/).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const MOVED = [
  "renovate.json",
  "SECURITY.md",
  ".gitleaks.toml",
  ".jscpd.json",
  ".dependency-cruiser.cjs",
  ".semgrep",
  ".githooks",
];
/** An old root path: one of MOVED not preceded by a path segment (".github/renovate.json" is the new place). */
const OLD_PATH = new RegExp(`(?<![\\w./-])(${MOVED.map((p) => p.replaceAll(".", "\\.")).join("|")})(?![\\w-])`);

/** Tracked files only: build output under dist/ is not the repository. */
const filesUnder = (dir: string): string[] =>
  execFileSync("git", ["ls-files", "-z", "--", dir], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);

/**
 * What runs or documents the repository. Left out: ADRs (never edited once accepted), the AI working notes and book
 * (history), engineering-rules.md (a byte copy the architecture thread owns; its text follows in that thread's next
 * re-copy), and test files, whose example paths are data and which fail on their own if they read a moved file.
 */
function referencing(): string[] {
  return [
    "package.json",
    "README.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".semgrepignore",
    ...filesUnder(".github"),
    ...filesUnder("scripts").filter((f) => !f.endsWith(".test.ts") && !f.includes("/fixtures/")),
    ...filesUnder("docs/human").filter(
      (f) => !f.startsWith("docs/human/decisions/") && f !== "docs/human/engineering/engineering-rules.md",
    ),
  ];
}

test("moved_files_left_the_root", () => {
  const root = readdirSync(ROOT);
  expect(MOVED.filter((name) => root.includes(name))).toEqual([]);
});

test("no_old_root_paths_referenced", () => {
  const hits = referencing().flatMap((file) =>
    read(file)
      .split("\n")
      .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
      // The base's "# checks:" entries stay until this step merges: the guard reads base and head together.
      .filter(({ line }) => !line.startsWith("# checks:") && OLD_PATH.test(line))
      .map(({ at, line }) => `${at}: ${line.trim()}`),
  );
  expect(hits).toEqual([]);
});

test("old_path_pattern_tells_old_from_new", () => {
  expect(OLD_PATH.test("npx jscpd --config .jscpd.json .")).toBe(true);
  expect(OLD_PATH.test("git config core.hooksPath .githooks")).toBe(true);
  expect(OLD_PATH.test("see SECURITY.md")).toBe(true);
  expect(OLD_PATH.test("npx jscpd --config .github/.jscpd.json .")).toBe(false);
  expect(OLD_PATH.test("depcruise --config scripts/lint/.dependency-cruiser.cjs .")).toBe(false);
  expect(OLD_PATH.test("[policy](../../.github/SECURITY.md)")).toBe(false);
});

test("hooks_path_documented", () => {
  expect(read("README.md")).toContain("git config core.hooksPath scripts/githooks");
  for (const hook of ["commit-msg", "pre-commit"])
    expect(read(`scripts/githooks/${hook}`)).toContain("git config core.hooksPath scripts/githooks");
});

test("tools_read_their_moved_config", () => {
  const ci = read(".github/workflows/ci.yml");
  expect(ci.match(/--config \.github\/\.gitleaks\.toml/g)).toHaveLength(2);
  expect(ci).toContain("--config scripts/lint/semgrep/");
  expect(ci).toContain("--config .github/.jscpd.json");
  // Named, so a missing file fails the validator instead of it finding nothing to check (Renovate 44.115.13
  // dist/config-validator.js validates the named files, else whichever default names exist).
  expect(ci).toMatch(/renovate-config-validator "\$RENOVATE_IMAGE"\n\s+--strict \.github\/renovate\.json/);
  expect(JSON.parse(read("package.json")).scripts.lint).toContain("--config scripts/lint/.dependency-cruiser.cjs");
  // gitleaks 8.30.1 falls back to its default rules, silently, when no --config is given and the root has none.
  expect(read("scripts/githooks/pre-commit")).toContain("--config .github/.gitleaks.toml");
});
