// The secrets job's shape and the one public-key exception (P0.07a). The gitleaks runs themselves happen in the CI
// `secrets` job (scripts/ci/secrets-fixtures.ts); this file checks what can be checked without gitleaks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { code, jobs, problems } from "../guards/workflows.ts";
import { CASES, imageFromWorkflow, keys } from "./secrets-fixtures.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const toml = readFileSync(join(ROOT, ".github/.gitleaks.toml"), "utf8");
const secrets = (jobs(code(ci)).get("secrets") ?? []).join("\n");
/** A GitHub `${{ }}` expression, built so the text needs no lint exception. */
const expr = (inner: string): string => `$${"{{"} ${inner} }}`;

/** The text of the step named `name` in the secrets job, up to the next step. */
function step(name: string): string {
  const start = secrets.indexOf(`- name: ${name}\n`);
  if (start < 0) throw new Error(`secrets job has no step ${name}`);
  const next = secrets.indexOf("\n      - ", start + 1);
  return secrets.slice(start, next < 0 ? undefined : next);
}

/** The single [[allowlists]] block of .github/.gitleaks.toml. */
function exception(): { targetRules: string; regexTarget: string; regexes: RegExp[] } {
  const blocks = toml.split("[[allowlists]]").slice(1);
  expect(blocks).toHaveLength(1);
  const block = blocks[0] ?? "";
  return {
    targetRules: /^targetRules = (.+)$/m.exec(block)?.[1] ?? "",
    regexTarget: /^regexTarget = (.+)$/m.exec(block)?.[1] ?? "",
    regexes: [...block.matchAll(/^ {2}'''(.+)''',$/gm)].map((m) => new RegExp(m[1] ?? "")),
  };
}

const allowed = (secret: string): boolean => exception().regexes.some((re) => re.test(secret));

describe("secrets job scope", () => {
  test("sha_from_env_not_inline", () => {
    expect(secrets).toContain(`BASE_SHA: ${expr("github.event.pull_request.base.sha")}`);
    expect(secrets).toContain(`HEAD_SHA: ${expr("github.event.pull_request.head.sha")}`);
    expect(step("Scan this pull request's commits")).toContain('--log-opts="$BASE_SHA..$HEAD_SHA"');
    expect(problems(ci)).toEqual([]);
    const inline = ci.replace('"$BASE_SHA..$HEAD_SHA"', `${expr("github.event.pull_request.base.sha")}..HEAD`);
    expect(problems(inline)).toEqual([expect.stringMatching(/^expression inside run:/)]);
  });

  test("pr_scans_range_and_main_scans_everything", () => {
    const pr = step("Scan this pull request's commits");
    expect(pr).toContain("if: github.event_name == 'pull_request'");
    for (const sha of ["BASE_SHA", "HEAD_SHA"])
      expect(pr).toContain(`git rev-parse --verify --quiet "$${sha}^{commit}"`);
    expect(pr).toContain('test "$(git rev-list --count "$BASE_SHA..$HEAD_SHA")" -gt 0');
    const full = step("Scan full history");
    expect(full).toContain("if: github.event_name != 'pull_request'");
    expect(full).not.toContain("--log-opts");
    expect(secrets).toContain("fetch-depth: 0");
    expect(step("Scan working tree")).not.toContain("if:");
    for (const s of [pr, full, step("Scan working tree")]) expect(s).toContain('"$GITLEAKS_IMAGE"');
    expect(step("Prove the scan on planted fixtures")).toContain("node scripts/ci/secrets-fixtures.ts");
  });

  test("fixtures_use_ci_image", () => {
    expect(imageFromWorkflow(ci)).toMatch(/^ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:[0-9a-f]{64}$/);
  });

  test("every_required_case_is_planted", () => {
    const names = CASES.map((c) => c.name.split(" ")[0]);
    for (const name of [
      "pr_range_planted_secret_fails",
      "other_branch_secret_not_pr_gate",
      "main_full_history_finds_it",
      "public_did_key_vectors_pass",
      "public_vectors_fail_without_exception",
      "private_multibase_still_fails",
      "api_key_beside_public_key_fails",
      "wrong_length_zq3s_fails",
    ])
      expect(names).toContain(name);
  });
});

describe("public-key exception", () => {
  test("exception_targets_one_rule_on_the_secret", () => {
    const { targetRules, regexTarget, regexes } = exception();
    expect(targetRules).toBe('["generic-api-key"]');
    expect(regexTarget).toBe('"secret"');
    expect(regexes).toHaveLength(2);
    for (const re of regexes) expect(re.source).toMatch(/^\^.*\$$/);
    expect(toml).toContain("No other\n# entry without an architecture ruling.");
  });

  test("fixture_keys_have_their_encodings", () => {
    expect(keys.k256Public("t")).toMatch(/^zQ3s[1-9A-HJ-NP-Za-km-z]{45}$/);
    expect(keys.p256Public("t")).toMatch(/^zDn[1-9A-HJ-NP-Za-km-z]{46}$/);
    expect(keys.k256PublicLong("t")).toMatch(/^zQ3s[1-9A-HJ-NP-Za-km-z]{46}$/);
    expect(keys.k256PublicShort("t")).toMatch(/^zQ3s[1-9A-HJ-NP-Za-km-z]{44}$/);
    expect(keys.k256Private("t")).toMatch(/^z3vL/);
    expect(keys.p256Private("t")).toMatch(/^z42t/);
    expect(keys.plc("t")).toMatch(/^did:plc:[a-z2-7]{24}$/);
  });

  test("exception_matches_public_identifiers_only", () => {
    for (const label of ["a", "b", "c", "d"]) {
      for (const key of [keys.k256Public(label), keys.p256Public(label)]) {
        expect(allowed(key)).toBe(true);
        expect(allowed(`did:key:${key}`)).toBe(true);
        expect(allowed(`${key}x`)).toBe(false);
        expect(allowed(`apiKey=${key}`)).toBe(false);
      }
      expect(allowed(keys.plc(label))).toBe(true);
      expect(allowed(`${keys.plc(label)}a`)).toBe(false);
      for (const key of [
        keys.k256Private(label),
        keys.p256Private(label),
        keys.k256PublicLong(label),
        keys.k256PublicShort(label),
      ]) {
        expect(allowed(key)).toBe(false);
        expect(allowed(`did:key:${key}`)).toBe(false);
      }
      expect(allowed(keys.apiKey(label))).toBe(false);
    }
  });
});
