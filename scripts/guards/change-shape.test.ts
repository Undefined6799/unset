import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runChangeShape, type ShapeInput } from "./change-shape.ts";
import { checkCommitMessage, checkPrTitle } from "./commit-msg.ts";
import { checkPerfEvidence } from "./perf-evidence.ts";
import { measurePrSize } from "./pr-size.ts";
import { checkPrTemplate } from "./pr-template.ts";
import {
  checkPathsMixed,
  checkTrustedBaseIsolation,
  type DocFacts,
  readTrustedBase,
  unionTrustedBase,
} from "./trusted-base.ts";

/** Every path a regular file, as git reports most; `symlinks` and `licenceOnly` say what else git found. */
const docsFor = (paths: readonly string[], symlinks: string[] = [], licenceOnly: string[] = []): DocFacts => ({
  regular: new Set(paths.filter((p) => !symlinks.includes(p))),
  licenceOnly: new Set(licenceOnly),
  dependencyChanges: new Set(),
  lockfiles: null,
});

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const TEMPLATE = read(".github/pull_request_template.md");

const errorsOf = (message: string): string[] => {
  const result = checkCommitMessage(message);
  return result.ok ? [] : result.errors;
};

describe("commit messages and the PR title (D2, DL-6)", () => {
  test("commit_valid", () => {
    expect(checkCommitMessage("P1.07 Enforce exact Origin match in CSRF gate")).toEqual({ ok: true });
    expect(checkCommitMessage("P1.07 Enforce exact Origin match in CSRF gate\n\nThe gate compared hosts.\n")).toEqual({
      ok: true,
    });
    expect(checkCommitMessage("L.02 Fail the gate on an open sev-1")).toEqual({ ok: true });
    expect(checkCommitMessage("P0.09c Check the shape of every change")).toEqual({ ok: true });
  });

  test("commit_requires_step_id", () => {
    expect(errorsOf("Enforce exact Origin match")).toEqual(["subject.no_step_id"]);
    expect(errorsOf("P7.01 Enforce exact Origin match")).toEqual(["subject.no_step_id"]);
    expect(errorsOf("P1.7 Enforce exact Origin match")).toEqual(["subject.no_step_id"]);
  });

  test("commit_rejects_conventional", () => {
    expect(errorsOf("P1.07 fix(csrf): match origin")).toContain("subject.conventional_prefix");
    expect(errorsOf("fix(csrf): match origin")).toContain("subject.conventional_prefix");
    expect(errorsOf("feat!: break things")).toContain("subject.conventional_prefix");
  });

  test("commit_capital_no_period_lengths", () => {
    expect(errorsOf("P1.07 enforce exact Origin match")).toEqual(["subject.lowercase"]);
    expect(errorsOf("P1.07 Enforce exact Origin match.")).toEqual(["subject.trailing_period"]);
    expect(errorsOf(`P1.07 ${"A".repeat(51)}`)).toEqual(["subject.too_long"]);
    expect(errorsOf(`P1.07 ${"A".repeat(50)}`)).toEqual([]);
    // 73 characters in all with a summary of 50: the id is longer than the usual 5.
    expect(errorsOf(`L.02a ${"A".repeat(50)}`)).toEqual([]);
    expect(errorsOf("P1.07 Enforce it\nBody straight after the subject")).toEqual(["body.no_blank_line"]);
    expect(errorsOf(`P1.07 Enforce it\n\n${"b".repeat(73)}`)).toEqual(["body.line_too_long"]);
    expect(errorsOf(`P1.07 Enforce it\n\n${"b".repeat(72)}`)).toEqual([]);
    expect(errorsOf(`P1.07 Enforce it\n\nhttps://example.org/${"x".repeat(80)}`)).toEqual([]);
  });

  test("commit_subject_over_72_fails", () => {
    // A step id is at most 6 characters, so the 50-character summary limit binds first; both report one error.
    expect(checkPrTitle(`P1.07 ${"A".repeat(50)}`)).toEqual({ ok: true });
    expect(checkPrTitle(`P1.07 ${"A ".repeat(40)}`)).toEqual({ ok: false, errors: ["subject.too_long"] });
  });

  test("revert_and_fixup_commits", () => {
    expect(
      checkCommitMessage('Revert "P1.07 Enforce exact Origin match in CSRF gate"\n\nThis reverts commit abc.'),
    ).toEqual({
      ok: true,
    });
    expect(errorsOf('Revert "fix: thing"')).toContain("subject.conventional_prefix");
    expect(errorsOf("fixup! P1.07 Enforce exact Origin match")).toEqual(["subject.no_step_id"]);
    // CI reads commits with --no-merges, so a regular commit that only says "Merge" is still checked.
    expect(errorsOf("Merge branch 'main' into claude/p0-09c")).toEqual(["subject.no_step_id"]);
    // A bare step id, and a trailing period hidden by spaces.
    expect(errorsOf("P1.07")).toEqual(["subject.lowercase"]);
    expect(checkPrTitle("P1.07")).toEqual({ ok: false, errors: ["subject.lowercase"] });
    expect(errorsOf("P1.07 Enforce it.  ")).toEqual(["subject.trailing_period"]);
  });
});

describe("PR size (D3)", () => {
  const row = (lines: number, path: string): string => `${lines}\t0\t${path}`;

  test("size_counts_source_only", () => {
    const numstat = [
      row(300, "shared/http/csrf/gate.ts"),
      row(900, "shared/http/csrf/gate.test.ts"),
      row(500, "tests/integration/x.ts"),
      row(400, "scripts/guards/fixtures/notes/a.md"),
      row(5000, "package-lock.json"),
      row(700, "shared/lexicons/x.generated.ts"),
      row(600, "shared/lexicons/sh/unset/video.json"),
      "-\t-\tdocs/logo.png",
    ].join("\n");
    expect(measurePrSize(numstat, [], "")).toEqual({ changed: 300, level: "ok" });
  });

  test("size_warns_over_400", () => {
    expect(measurePrSize(`200\t201\tapps/web/a.ts`, [], "").level).toBe("warn");
    expect(measurePrSize(`200\t200\tapps/web/a.ts`, [], "").level).toBe("ok");
  });

  test("size_fails_over_800", () => {
    expect(measurePrSize(`801\t0\tapps/web/a.ts`, [], "")).toEqual({
      changed: 801,
      level: "fail",
      reason: "over 800 changed source lines without the large-pr label and a `Large PR:` reason",
    });
  });

  test("size_label_needs_reason", () => {
    expect(measurePrSize(`900\t0\tapps/web/a.ts`, ["large-pr"], "").level).toBe("fail");
    expect(measurePrSize(`900\t0\tapps/web/a.ts`, ["large-pr"], "Large PR:   \n").level).toBe("fail");
    expect(measurePrSize(`900\t0\tapps/web/a.ts`, [], "Large PR: generated client").level).toBe("fail");
    expect(measurePrSize(`900\t0\tapps/web/a.ts`, ["large-pr"], "x\nLarge PR: one parser, kept whole\n")).toEqual({
      changed: 900,
      level: "warn",
      reason: "large-pr: one parser, kept whole",
    });
  });
});

describe("PR template and performance evidence", () => {
  const bodyWith = (skip: string): string =>
    [...TEMPLATE.matchAll(/^## (.+)$/gm)]
      .map((m) => m[1] as string)
      .filter((h) => h !== skip)
      .map((h) => `## ${h}\nn/a\n`)
      .join("\n");

  test("template_headings_required", () => {
    expect(checkPrTemplate(bodyWith("Why"), TEMPLATE)).toEqual(["Why"]);
    expect(checkPrTemplate(bodyWith(""), TEMPLATE)).toEqual([]);
    // CRLF bodies, as GitHub's web editor sends them.
    expect(checkPrTemplate(bodyWith("").replaceAll("\n", "\r\n"), TEMPLATE)).toEqual([]);
  });

  test("perf_evidence_required", () => {
    const speed = "+++ b/infrastructure/postgres/migrations/0042_x.sql\n+CREATE INDEX x ON app.t (a); -- why: speed\n";
    const unique =
      "+++ b/infrastructure/postgres/migrations/0042_x.sql\n+CREATE UNIQUE INDEX x ON app.t (a); -- why: unique\n";
    const body = (evidence: string) => `## Performance evidence\n${evidence}\n\n## Migration or rollback\nn/a\n`;
    expect(checkPerfEvidence(speed, body("n/a"))).toBe(true);
    expect(checkPerfEvidence(speed, body("p50 4 ms → 1 ms, p95 9 ms → 2 ms"))).toBe(true);
    expect(checkPerfEvidence(speed, body("Before and after: p50 4→1 ms, p95 9→2 ms, p99 20→3 ms"))).toBe(false);
    expect(checkPerfEvidence(unique, body("n/a"))).toBe(false);
    // A removed line does not need evidence.
    expect(checkPerfEvidence("-CREATE INDEX x ON app.t (a); -- why: speed\n", body("n/a"))).toBe(false);
  });
});

describe("trusted base (SE-6)", () => {
  const CODEOWNERS = [
    "* @Undefined6799",
    "",
    "# trusted base (SE-6)",
    "# A note the parser ignores.",
    "# parsed: /infrastructure/postgres/migrations/ /infrastructure/postgres/grant-matrix.json",
    "# trusted functions: core.erase_* core.is_erased",
    "# checks: /scripts/guards/ /.github/",
    "/shared/http/ @Undefined6799",
    "/infrastructure/postgres/roles.json @Undefined6799",
    "",
  ].join("\n");
  const base = readTrustedBase(CODEOWNERS);
  if (!base.ok) throw new Error(base.error);
  const { patterns, parsedPaths, checks } = base.section;
  const MIGRATION = "infrastructure/postgres/migrations/0042_x.sql";
  const finding = (kind: "trusted" | "feature" | "neutral") => ({
    path: MIGRATION,
    line: 1,
    kind,
    reason: kind,
    statement: "…",
  });
  const isolate = (paths: string[], findings = [] as ReturnType<typeof finding>[]) =>
    checkTrustedBaseIsolation(paths, patterns, { parsedPaths, findings, docs: docsFor(paths) });

  test("trusted_base_list_from_codeowners", () => {
    expect(base.section).toEqual({
      patterns: ["/shared/http/", "/infrastructure/postgres/roles.json"],
      parsedPaths: ["/infrastructure/postgres/migrations/", "/infrastructure/postgres/grant-matrix.json"],
      trustedFunctions: ["core.erase_*", "core.is_erased"],
      checks: ["/scripts/guards/", "/.github/"],
    });
    const real = readTrustedBase(read(".github/CODEOWNERS"));
    expect(real.ok && real.section.patterns).toEqual(
      expect.arrayContaining(["/deployment/edge/", "/shared/lexicons/", "/interfaces/chat-auth/"]),
    );
    expect(real.ok && real.section.parsedPaths.length).toBeGreaterThan(0);
    const broken = (text: string) => readTrustedBase(text).ok;
    expect(broken("* @Undefined6799\n")).toBe(false);
    expect(broken(`${CODEOWNERS}\n# Later section\n/apps/ @Undefined6799\n`)).toBe(false);
    expect(broken(CODEOWNERS.replace("# parsed:", "\n# parsed:"))).toBe(false);
    expect(broken(CODEOWNERS.replace("# trusted functions:", "# trusted functions: a.b\n# trusted functions:"))).toBe(
      false,
    );
    expect(broken(CODEOWNERS.replace(/# parsed:.*\n/, ""))).toBe(false);
    expect(broken(CODEOWNERS.replace(/^\/.*\n/gm, ""))).toBe(false);
    // A missing "# checks:" line reads as none (the base before P0.09c); change-shape.ts fails if both sides have none.
    const noChecks = readTrustedBase(CODEOWNERS.replace(/# checks:.*\n/, ""));
    expect(noChecks.ok && noChecks.section.checks).toEqual([]);
    expect(broken(CODEOWNERS.replace("# checks: /scripts/guards/", "# checks: scripts/guards/"))).toBe(false);
    expect(real.ok && real.section.checks).toEqual([
      "/scripts/guards/",
      "/scripts/lint/",
      "/scripts/ci/",
      "/scripts/budgets/",
      "/scripts/licence/",
      "/scripts/docs/",
      "/scripts/test/",
      "/scripts/workspace/",
      "/scripts/githooks/",
      "/.github/",
      "/.githooks/",
      "/.semgrep/",
      "/.semgrepignore",
      "/.dependency-cruiser.cjs",
    ]);
    expect(broken(`${CODEOWNERS}# trusted base (SE-6)\n/x/ @Undefined6799\n`)).toBe(false);
  });

  test("checks_list_complete", () => {
    // Ruling 2026-10-05 01:43Z: only the scripts/ folders whose code decides pass or fail are check paths, so every
    // scripts/ folder a workflow or the root package.json runs must be on the "# checks:" line (fail closed).
    const unlisted = (text: string, list: readonly string[]): string[] =>
      [...text.matchAll(/scripts\/([A-Za-z0-9_.-]+)/g)]
        .map((m) => `/scripts/${m[1]}/`)
        .filter((dir) => !list.includes(dir));
    const real = readTrustedBase(read(".github/CODEOWNERS"));
    if (!real.ok) throw new Error(real.error);
    const workflows = readdirSync(join(ROOT, ".github", "workflows")).map((f) => read(`.github/workflows/${f}`));
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(unlisted([...workflows, ...Object.values(pkg.scripts)].join("\n"), real.section.checks)).toEqual([]);
    expect(unlisted("run: node scripts/dev/seed.ts", real.section.checks)).toEqual(["/scripts/dev/"]);
  });

  // SE-6 ruling 2026-10-05 (refined 01:15Z): CI runs the PR's own checks, so a PR that changes a check path changes no
  // product path. Tests, fixtures, docs and repo config may ride with it.
  test("check_pr_alone_ok", () => {
    expect(
      checkPathsMixed(
        ["scripts/guards/x.ts", ".github/labels.json"],
        checks,
        docsFor(["scripts/guards/x.ts", ".github/labels.json"]),
      ),
    ).toEqual([]);
    // A product PR with no check path is the trusted-base check's business, not this one's.
    expect(
      checkPathsMixed(
        ["shared/http/csrf/gate.ts", "apps/web/a.ts"],
        checks,
        docsFor(["shared/http/csrf/gate.ts", "apps/web/a.ts"]),
      ),
    ).toEqual([]);
  });

  test("check_plus_product_fails", () => {
    expect(
      checkPathsMixed(
        [".github/labels.json", "shared/http/csrf/gate.ts", "apps/web/a.ts"],
        checks,
        docsFor([".github/labels.json", "shared/http/csrf/gate.ts", "apps/web/a.ts"]),
      ),
    ).toEqual(["shared/http/csrf/gate.ts", "apps/web/a.ts"]);
  });

  test("check_plus_docs_and_tests_ok", () => {
    const ride = ["scripts/guards/x.test.ts", "docs/ai/book/phase-0.md", "docs/human/x.md", "tests/e2e/x.test.ts"];
    expect(
      checkPathsMixed(
        ["scripts/guards/x.ts", "renovate.json", ...ride],
        checks,
        docsFor(["scripts/guards/x.ts", "renovate.json", ...ride]),
      ),
    ).toEqual([]);
  });

  test("checks_line_union_of_base_and_head", () => {
    // The head drops /.semgrep/ from "# checks:"; the base still lists it, so .semgrep/ plus domains/ still fails.
    const side = (list: string[]) => ({ patterns: [], parsedPaths: [], trustedFunctions: [], checks: list });
    const merged = unionTrustedBase(side(["/.github/", "/.semgrep/"]), side(["/.github/"]));
    expect(merged.checks).toEqual(["/.github/", "/.semgrep/"]);
    expect(
      checkPathsMixed(
        [".semgrep/rules/x.yml", "domains/content/x.ts"],
        merged.checks,
        docsFor([".semgrep/rules/x.yml", "domains/content/x.ts"]),
      ),
    ).toEqual(["domains/content/x.ts"]);
  });

  test("fixture_is_check_path", () => {
    expect(
      checkPathsMixed(
        ["infrastructure/postgres/migrations/0042_x.sql", "scripts/guards/fixtures/a.sql"],
        checks,
        docsFor(["infrastructure/postgres/migrations/0042_x.sql", "scripts/guards/fixtures/a.sql"]),
      ),
    ).toEqual(["infrastructure/postgres/migrations/0042_x.sql"]);
  });

  test("doc_exemptions_in_both_checks", () => {
    // Architecture rulings 2026-10-05 01:31Z and 01:40Z: a package's LICENSE, any *.md and a package.json diff that
    // changes only `license` are documentation in both checks, so P0.13 (scripts/licence plus the LICENSE files) is one
    // PR, while a check PR still cannot carry a dependency change.
    expect(isolate(["shared/http/LICENSE", "shared/config/LICENSE", "shared/log/LICENSE.txt"])).toEqual({
      ok: true,
      touched: false,
    });
    expect(isolate(["shared/http/LICENSE", "shared/http/index.ts"])).toEqual({ ok: true, touched: true });
    expect(isolate(["shared/http/LICENSE.md", "shared/http/index.ts", "domains/content/x.ts"])).toEqual({
      ok: false,
      outside: ["domains/content/x.ts"],
    });
    // Only the exact basename at a package root: anything else in a trusted folder is still trusted base.
    for (const name of [
      "shared/http/license.ts",
      "shared/http/LICENSE.ts",
      "shared/http/LICENSES",
      "shared/http/csp/LICENSE",
    ]) {
      expect(isolate([name, "shared/config/LICENSE", "domains/content/x.ts"]), name).toEqual({
        ok: false,
        outside: ["domains/content/x.ts"],
      });
    }
    const SCRIPTS = ["/scripts/licence/"]; // a check folder on the real "# checks:" line
    const licencePr = [
      "scripts/licence/check.ts",
      "shared/http/LICENSE",
      "shared/config/LICENSE",
      "shared/x/README.md",
    ];
    expect(checkPathsMixed(licencePr, SCRIPTS, docsFor(licencePr))).toEqual([]);
    const manifest = ["scripts/licence/check.ts", "shared/config/package.json"];
    expect(checkPathsMixed(manifest, SCRIPTS, docsFor(manifest, [], ["shared/config/package.json"]))).toEqual([]);
    expect(checkPathsMixed(manifest, SCRIPTS, docsFor(manifest))).toEqual(["shared/config/package.json"]);
    // A licence-only manifest in a trusted folder does not touch the trusted base either.
    const http = ["shared/http/package.json", "domains/content/x.ts"];
    expect(
      checkTrustedBaseIsolation(http, patterns, {
        parsedPaths,
        findings: [],
        docs: docsFor(http, [], [http[0] as string]),
      }),
    ).toEqual({ ok: true, touched: false });
  });

  test("symlink_license_not_exempt", () => {
    // A symlink is judged by its location, whatever its name (git mode 120000, not 100644).
    for (const link of ["shared/http/LICENSE", "shared/http/README.md"]) {
      const paths = [link, "domains/content/x.ts"];
      expect(
        checkTrustedBaseIsolation(paths, patterns, { parsedPaths, findings: [], docs: docsFor(paths, [link]) }),
        link,
      ).toEqual({
        ok: false,
        outside: ["domains/content/x.ts"],
      });
    }
    const SCRIPTS = ["/scripts/licence/"];
    const paths = ["scripts/licence/check.ts", "shared/config/LICENSE"];
    expect(checkPathsMixed(paths, SCRIPTS, docsFor(paths, ["shared/config/LICENSE"]))).toEqual([
      "shared/config/LICENSE",
    ]);
  });

  test("trusted_base_isolated", () => {
    expect(isolate(["shared/http/csrf/gate.ts", "shared/http/csrf/gate.test.ts"])).toEqual({ ok: true, touched: true });
    expect(isolate(["shared/http/csrf/gate.ts", "interfaces/http/routes/profile.ts"])).toEqual({
      ok: false,
      outside: ["interfaces/http/routes/profile.ts"],
    });
    expect(isolate([MIGRATION, "domains/content/x.ts"], [finding("trusted")])).toEqual({
      ok: false,
      outside: ["domains/content/x.ts"],
    });
    expect(isolate([MIGRATION, "domains/content/x.ts"], [finding("feature"), finding("neutral")])).toEqual({
      ok: true,
      touched: false,
    });
    expect(isolate(["domains/content/x.ts"])).toEqual({ ok: true, touched: false });
    expect(isolate(["shared/http/README.md", "shared/http/csp/build.ts"])).toEqual({ ok: true, touched: true });
    // A grants-only PR with its integration test and human docs.
    expect(
      isolate(
        [
          MIGRATION,
          "infrastructure/postgres/roles.json",
          "tests/integration/postgres/grants.test.ts",
          "docs/human/x.md",
        ],
        [finding("trusted")],
      ),
    ).toEqual({ ok: true, touched: true });
    // Trusted and feature statements in one migration: the grants go in their own file and PR.
    expect(isolate([MIGRATION], [finding("trusted"), finding("feature")])).toEqual({
      ok: false,
      outside: [`${MIGRATION} (mixed_grant_change)`],
    });
    // A test elsewhere is not a test of the trusted base.
    expect(isolate(["shared/http/csrf/gate.ts", "tests/integration/profile.test.ts"])).toEqual({
      ok: false,
      outside: ["tests/integration/profile.test.ts"],
    });
  });
});

describe("the pr-shape job", () => {
  const goodBody = [...TEMPLATE.matchAll(/^## (.+)$/gm)].map((m) => `## ${m[1]}\nn/a\n`).join("\n");
  const input = (over: Partial<ShapeInput>): ShapeInput => ({
    title: "P0.09c Check the shape of every change",
    body: goodBody,
    labels: ["kind/build"],
    commits: [{ sha: "abc1234", message: "P0.09c Check the shape of every change\n" }],
    numstat: "10\t0\tscripts/guards/x.ts",
    template: TEMPLATE,
    changedPaths: ["scripts/guards/x.ts"],
    trustedBase: base_,
    grantFindings: [],
    migrationDiff: "",
    docs: docsFor(over.changedPaths ?? ["scripts/guards/x.ts"]),
    ...over,
  });
  const section = readTrustedBase(read(".github/CODEOWNERS"));
  if (!section.ok) throw new Error(section.error);
  const base_ = section.section;

  test("title_checked", () => {
    expect(runChangeShape(input({})).errors).toEqual([]);
    expect(runChangeShape(input({ title: "fix: thing" })).errors).toEqual([
      "[D2] PR title: subject.no_step_id, subject.conventional_prefix",
    ]);
    expect(runChangeShape(input({ commits: [{ sha: "def5678", message: "wip" }] })).errors).toEqual([
      "[D2] commit def5678: subject.no_step_id",
    ]);
  });

  test("job_reports_every_check", () => {
    const out = runChangeShape(
      input({
        labels: [],
        numstat: "900\t0\tapps/web/a.ts",
        body: "## Step\nx\n",
        changedPaths: ["shared/http/csrf/gate.ts", "apps/web/a.ts"],
        grantFindings: [
          {
            path: "infrastructure/postgres/migrations/0042_x.sql",
            line: 3,
            kind: "trusted",
            reason: "unclassified",
            statement: "DO $$ BEGIN END $$",
          },
        ],
        migrationDiff: "+CREATE INDEX i ON app.t (a); -- why: speed\n",
      }),
    );
    expect(out.errors).toContain(
      "[D3] PR size: 900 changed source lines: over 800 changed source lines without the large-pr label and a `Large PR:` reason",
    );
    expect(out.errors.some((e) => e.startsWith("[DL-3] PR body is missing headings: What, Why,"))).toBe(true);
    expect(out.errors).toContain("[SE-6] outside the trusted base in a trusted-base PR: apps/web/a.ts");
    expect(out.errors).toContain(
      "[SE-6] infrastructure/postgres/migrations/0042_x.sql:3 unclassified: DO $$ BEGIN END $$",
    );
    expect(out.errors).toContain(
      "[PF-1] a `-- why: speed` index needs p50, p95 and p99 before and after in Performance evidence",
    );
    expect(out.warnings).toEqual(["[D2] expected exactly one kind/* label, found none"]);
  });
});
