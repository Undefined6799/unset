// P0.09g: the repository root holds only what must live there. Seven config and check files moved to .github/ and
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
const NAME = new RegExp(`(?<![\\w-])(${MOVED.map((p) => p.replaceAll(".", "\\.")).join("|")})(?![\\w-])`, "g");
/** Where the moved files live now: a name right after one of these is the new path, anywhere else the old one. */
const NEW_HOMES = [".github/", "scripts/lint/"];

/** Whether `line` names a moved file at its old root place (`./renovate.json`, `$PWD/.gitleaks.toml` included). */
const namesOldPath = (line: string): boolean =>
  [...line.matchAll(NAME)].some((m) => !NEW_HOMES.some((home) => line.slice(0, m.index).endsWith(home)));

/**
 * Every tracked file that runs or documents the repository (CODEOWNERS' "# checks:" line too, since P0.09h). Left out: ADRs (never edited once accepted), the AI working
 * notes and book (history), engineering-rules.md (a byte copy the architecture thread owns; its text follows in that
 * thread's next re-copy), the lockfile, fixtures, and test files, whose example paths are data and which fail on their
 * own if they read a moved file.
 */
function referencing(): string[] {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  return tracked.filter(
    (f) =>
      !f.startsWith("docs/ai/") &&
      !f.startsWith("docs/human/decisions/") &&
      f !== "docs/human/engineering/engineering-rules.md" &&
      f !== "package-lock.json" &&
      !f.includes("/fixtures/") &&
      !f.endsWith(".test.ts"),
  );
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
      .filter(({ line }) => namesOldPath(line))
      .map(({ at, line }) => `${at}: ${line.trim()}`),
  );
  expect(hits).toEqual([]);
});

test("old_path_pattern_tells_old_from_new", () => {
  for (const old of [
    "npx jscpd --config .jscpd.json .",
    "git config core.hooksPath .githooks",
    "see SECURITY.md",
    "gitleaks dir --config ./.gitleaks.toml .",
    'docker run -v "$PWD:/repo" x $PWD/renovate.json',
    'exec "$(dirname "$0")/../.githooks/commit-msg"',
    "[policy](../../SECURITY.md)",
    "ok .github/.jscpd.json, but not .jscpd.json",
  ])
    expect(namesOldPath(old), old).toBe(true);
  for (const moved of [
    "npx jscpd --config .github/.jscpd.json .",
    "depcruise --config scripts/lint/.dependency-cruiser.cjs .",
    "[policy](../../.github/SECURITY.md)",
    "semgrep scan --config scripts/lint/semgrep/ and .semgrepignore",
    "check_id scripts.lint.semgrep.computed-import",
  ])
    expect(namesOldPath(moved), moved).toBe(false);
});

test("hooks_path_documented", () => {
  expect(read("README.md")).toContain("git config core.hooksPath scripts/githooks");
  for (const hook of ["commit-msg", "pre-commit"])
    expect(read(`scripts/githooks/${hook}`)).toContain("git config core.hooksPath scripts/githooks");
});

test("tools_read_their_moved_config", () => {
  const ci = read(".github/workflows/ci.yml");
  // Every gitleaks run passes the config (P0.07a: PR range, full history, working tree).
  const scans = ci.match(/"\$GITLEAKS_IMAGE" (?:git|dir) /g) ?? [];
  expect(scans).toHaveLength(3);
  expect(ci.match(/--config \.github\/\.gitleaks\.toml/g)).toHaveLength(scans.length);
  expect(ci).toContain("--config scripts/lint/semgrep/");
  expect(ci).toContain("--config .github/.jscpd.json");
  // Named, so a missing file fails the validator instead of it finding nothing to check (Renovate 44.115.13
  // dist/config-validator.js validates the named files, else whichever default names exist).
  // --no-global: a named file is otherwise validated as global self-hosted config, which allows options a repository
  // config may not set (same file, `.option("--no-global", ...)`).
  expect(ci).toMatch(/renovate-config-validator "\$RENOVATE_IMAGE"\n\s+--strict --no-global \.github\/renovate\.json/);
  expect(JSON.parse(read("package.json")).scripts.lint).toContain("--config scripts/lint/.dependency-cruiser.cjs");
  // gitleaks 8.30.1 falls back to its default rules, silently, when no --config is given and the root has none.
  expect(read("scripts/githooks/pre-commit")).toContain("--config .github/.gitleaks.toml");
});
