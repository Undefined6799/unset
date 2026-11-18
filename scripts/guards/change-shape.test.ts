import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runChangeShape, type ShapeInput } from "./change-shape.ts";
import { checkCommitMessage, checkPrTitle } from "./commit-msg.ts";
import { checkPerfEvidence } from "./perf-evidence.ts";
import { measurePrSize } from "./pr-size.ts";
import { checkPrTemplate } from "./pr-template.ts";
import { matchesPattern, readTrustedBase, trustedPathsChanged, unionTrustedBase } from "./trusted-base.ts";

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
    expect(checkPrTemplate(bodyWith("What"), TEMPLATE)).toEqual(["What"]);
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
  test("trusted_base_list_from_codeowners", () => {
    expect(base.section).toEqual({
      patterns: ["/shared/http/", "/infrastructure/postgres/roles.json"],
      parsedPaths: ["/infrastructure/postgres/migrations/", "/infrastructure/postgres/grant-matrix.json"],
      trustedFunctions: ["core.erase_*", "core.is_erased"],
      checks: ["/scripts/guards/", "/.github/"],
    });
    const real = readTrustedBase(read(".github/CODEOWNERS"));
    expect(real.ok && real.section.patterns).toEqual(
      expect.arrayContaining([
        "/deployment/edge/",
        "/shared/lexicons/",
        "/interfaces/chat-auth/",
        "/infrastructure/postgres/roles.ts",
      ]),
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
      "/.semgrepignore",
      "/vitest.config.ts",
      "/biome.json",
      "/.npmrc",
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
    // Ruling 2026-10-06 03:15Z: the root configs that decide pass or fail (Vitest's retry, allowOnly, include and
    // globalSetup; Biome's lint and format rules) are check paths too.
    const configs = ["/vitest.config.ts", "/biome.json"];
    expect(configs.filter((path) => !real.section.checks.includes(path))).toEqual([]);
  });

  test("trusted_paths_named", () => {
    // ADR 0044: a path pattern, a "# parsed:" path or a "# checks:" path, whatever the file is. Nothing rides free.
    const changed = [
      "shared/http/csrf/gate.ts",
      "shared/http/csrf/gate.test.ts",
      "shared/http/README.md",
      "shared/httpx/a.ts",
      "infrastructure/postgres/roles.json",
      "infrastructure/postgres/roles.test.ts",
      "infrastructure/postgres/migrations/0042_x.sql",
      "infrastructure/postgres/grant-matrix.json",
      "scripts/guards/fixtures/a.sql",
      ".github/workflows/ci.yml",
      "domains/content/x.ts",
      "docs/human/decisions/0044-x.md",
      "tests/integration/http/gate.test.ts",
    ];
    expect(trustedPathsChanged(changed, base.section)).toEqual([
      "shared/http/csrf/gate.ts",
      "shared/http/csrf/gate.test.ts",
      "shared/http/README.md",
      "infrastructure/postgres/roles.json",
      "infrastructure/postgres/migrations/0042_x.sql",
      "infrastructure/postgres/grant-matrix.json",
      "scripts/guards/fixtures/a.sql",
      ".github/workflows/ci.yml",
    ]);
    expect(trustedPathsChanged(["domains/content/x.ts"], base.section)).toEqual([]);
  });

  test("a_double_star_pattern_matches_any_depth", () => {
    // P1.20k: every route's policy.ts is trusted, wherever the route sits (GitHub CODEOWNERS syntax: `**/` is zero or
    // more folders). It is the one wildcard form a trusted pattern may take.
    const pattern = "/interfaces/web/src/routes/**/policy.ts";
    expect(matchesPattern("interfaces/web/src/routes/policy.ts", pattern)).toBe(true);
    expect(matchesPattern("interfaces/web/src/routes/settings/profile/policy.ts", pattern)).toBe(true);
    expect(matchesPattern("interfaces/web/src/routes/[did=did]/policy.ts", pattern)).toBe(true);
    expect(matchesPattern("interfaces/web/src/routes/settings/+page.svelte", pattern)).toBe(false);
    expect(matchesPattern("interfaces/web/src/routes/settings/policy.ts.bak", pattern)).toBe(false);
    expect(matchesPattern("interfaces/web/src/lib/policy.ts", pattern)).toBe(false);
  });

  test("only_the_deep_name_wildcard_is_accepted", () => {
    for (const pattern of ["/a/*.ts", "/a/**", "/a/**/b/c.ts", "/a/**/*.ts", "a/**/policy.ts"]) {
      const section = readTrustedBase(
        CODEOWNERS.replace("/shared/http/ @Undefined6799\n", `${pattern} @Undefined6799\n`),
      );
      expect(section.ok, pattern).toBe(false);
    }
  });

  test("list_is_union_of_base_and_head", () => {
    // A PR cannot leave the list by editing it: a path the head's CODEOWNERS drops is still trusted for that PR.
    const head = readTrustedBase(CODEOWNERS.replace("/shared/http/ @Undefined6799\n", "").replace(" /.github/", ""));
    if (!head.ok) throw new Error(head.error);
    const changed = ["shared/http/csrf/gate.ts", ".github/CODEOWNERS"];
    expect(trustedPathsChanged(changed, head.section)).toEqual([]);
    expect(trustedPathsChanged(changed, unionTrustedBase(base.section, head.section))).toEqual(changed);
  });
});

describe("the pr-shape job", () => {
  const goodBody = [...TEMPLATE.matchAll(/^## (.+)$/gm)].map((m) => `## ${m[1]}\nn/a\n`).join("\n");
  const input = (over: Partial<ShapeInput>): ShapeInput => ({
    title: "P0.09c Check the shape of every change",
    body: goodBody,
    labels: ["kind/build"],
    author: { login: "Undefined6799", type: "User" },
    commits: [{ sha: "abc1234", message: "P0.09c Check the shape of every change\n" }],
    numstat: "10\t0\tdomains/content/x.ts",
    template: TEMPLATE,
    changedPaths: ["domains/content/x.ts"],
    trustedBase: base_,
    migrationDiff: "",
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
        migrationDiff: "+CREATE INDEX i ON app.t (a); -- why: speed\n",
      }),
    );
    expect(out.errors).toContain(
      "[D3] PR size: 900 changed source lines: over 800 changed source lines without the large-pr label and a `Large PR:` reason",
    );
    expect(out.errors).toContain(
      "[DL-3] PR body is missing headings: What, How to test, Security review, What I am unsure about",
    );
    expect(out.errors).toContain(
      "[SE-6] a PR that changes a trusted path carries the security-review label: shared/http/csrf/gate.ts",
    );
    expect(out.errors).toContain(
      "[PF-1] a `-- why: speed` index needs p50, p95 and p99 before and after in Performance evidence",
    );
    expect(out.warnings).toEqual(["[D2] expected exactly one kind/* label, found none"]);
  });

  test("trusted_path_needs_label", () => {
    // ADR 0044: a trusted path beside a product path passes with the label, and the job then names what was trusted.
    const changedPaths = ["shared/http/csrf/gate.ts", "apps/web/a.ts", ".github/workflows/ci.yml"];
    const named = "shared/http/csrf/gate.ts, .github/workflows/ci.yml";
    expect(runChangeShape(input({ changedPaths })).errors).toEqual([
      `[SE-6] a PR that changes a trusted path carries the security-review label: ${named}`,
    ]);
    const labelled = runChangeShape(input({ changedPaths, labels: ["kind/build", "security-review"] }));
    expect(labelled.errors).toEqual([]);
    expect(labelled.notices).toEqual([
      `[SE-6] trusted paths in this PR, for the security review of this head: ${named}`,
    ]);
    // No trusted path: no label needed, and nothing to announce.
    expect(runChangeShape(input({ labels: ["kind/build", "security-review"] })).notices).toEqual([]);
    // A long list is cut, with the count of what was left out.
    const many = Array.from({ length: 23 }, (_, i) => `shared/http/f${i}.ts`);
    expect(runChangeShape(input({ changedPaths: many })).errors[0]).toMatch(/f19\.ts, and 3 more$/);
  });

  test("renovate_needs_label_too", () => {
    // No author is exempt: anyone with write access can push to a renovate/ branch. Renovate labels its own PRs.
    const changedPaths = [".github/workflows/ci.yml"];
    const bot = { login: "renovate[bot]", type: "Bot" };
    expect(runChangeShape(input({ author: bot, changedPaths, body: "" })).errors).toHaveLength(1);
    const labels = ["deps", "kind/build", "security-review"];
    expect(runChangeShape(input({ author: bot, changedPaths, body: "", labels })).errors).toEqual([]);
    const config = JSON.parse(read(".github/renovate.json"));
    for (const own of [config.labels, config.vulnerabilityAlerts.labels] as string[][])
      expect(own).toContain("security-review");
  });

  // P0.09i (architecture ruling 2026-10-05 11:55Z): Renovate writes its own body, so only DL-3 is waived, and only for
  // the account GitHub reports as the renovate[bot] app; a person cannot register a "[bot]" login.
  const renovate = { login: "renovate[bot]", type: "Bot" };
  const headingErrors = (author: { login: string; type: string }): string[] =>
    runChangeShape(input({ author, body: "Renovate's table" })).errors.filter((e) => e.startsWith("[DL-3]"));

  test("renovate_bot_skips_headings", () => {
    expect(headingErrors(renovate)).toEqual([]);
  });

  test("other_bot_needs_headings", () => {
    expect(headingErrors({ login: "dependabot[bot]", type: "Bot" })).toHaveLength(1);
  });

  test("user_spoofing_renovate_login_fails", () => {
    expect(headingErrors({ login: "renovate[bot]", type: "User" })).toHaveLength(1);
  });

  test("renovate_without_kind_label_warns", () => {
    // Every other check still runs on its PRs: the kind label, the title and the size.
    const out = runChangeShape(
      input({ author: renovate, body: "", labels: ["deps"], title: "Update x", numstat: "900\t0\tapps/web/a.ts" }),
    );
    expect(out.warnings).toContain("[D2] expected exactly one kind/* label, found none");
    expect(out.errors.some((e) => e.startsWith("[D2] PR title"))).toBe(true);
    expect(out.errors.some((e) => e.startsWith("[D3] PR size"))).toBe(true);
  });

  test("renovate_labels_its_prs_with_one_kind", () => {
    const config = JSON.parse(read(".github/renovate.json"));
    for (const labels of [config.labels, config.vulnerabilityAlerts.labels] as string[][])
      expect(labels.filter((l) => l.startsWith("kind/"))).toEqual(["kind/build"]);
  });
});
