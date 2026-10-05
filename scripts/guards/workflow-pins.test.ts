// Checks every workflow against the CI rules (P0.07), and that each rule catches a planted violation.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { code, GATE_IF, jobs, problems } from "./workflows.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");
// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a JS template.
const PR_ONLY_CANCEL = "cancel-in-progress: ${{ github.event_name == 'pull_request' }}";

const workflowFiles = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
const ci = readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");

/** The real ci.yml with `extra` appended under `jobs:`, for planted violations. */
const withJob = (extra: string): string => `${ci.trimEnd()}\n${extra}\n`;
/** A GitHub `${{ }}` expression, built so planted text needs no lint exception. */
const expr = (inner: string): string => `$${"{{"} ${inner} }}`;
const job = (body: string): string =>
  `  planted:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n${body}`;

describe("workflows", () => {
  test.each(workflowFiles)("workflow_rules_hold %s", (file) => {
    expect(problems(readFileSync(join(WORKFLOWS, file), "utf8"))).toEqual([]);
  });

  test("all_actions_sha_pinned", () => {
    expect(problems(withJob(job("    steps:\n      - uses: actions/checkout@v7\n")))).toHaveLength(1);
    expect(problems(withJob(job(`    steps:\n      - uses: someone/action@${"a".repeat(40)}\n`)))).toHaveLength(1);
    expect(problems(withJob(job("    container: node:26\n")))).toHaveLength(1);
    expect(problems(withJob(job("    env:\n      X_IMAGE: alpine:3\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: docker run --rm alpine:3 true\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: docker create alpine:3\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: podman container run alpine:3\n")))).toHaveLength(1);
    expect(problems(withJob(job('    steps:\n      - "uses": evil/act@v1\n')))).toHaveLength(1);
    expect(problems(withJob(job(`    steps:\n      - uses: actions/github-script@${"a".repeat(40)}\n`)))).toHaveLength(
      1,
    );
    const runtimeImage = '    steps:\n      - run: echo "X_IMAGE=alpine:3" >> "$GITHUB_ENV"\n';
    expect(problems(withJob(job(runtimeImage)))).toEqual([
      expect.stringMatching(/image variable written at run time$/),
    ]);
  });

  test("least_privilege", () => {
    expect(problems(ci.replace("permissions: {}", "permissions: read-all"))).toContain(
      "top-level permissions is not {}",
    );
    expect(
      problems(withJob(job("    steps:\n      - run: true\n").replace("contents: read", "contents: write"))),
    ).toHaveLength(1);
    expect(problems(ci.replace("permissions: {}", "permissions: write-all"))).toHaveLength(2);
    const flowOidc = "    permissions: { contents: read, id-token: write }\n";
    expect(problems(withJob(`  planted:\n    runs-on: ubuntu-24.04\n${flowOidc}`))).toEqual([
      expect.stringMatching(/^job planted: secret or OIDC/),
    ]);
  });

  test("secrets_and_oidc_gated", () => {
    const oidc = "    permissions:\n      id-token: write\n    steps:\n      - run: true\n";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: planted workflow text with a GitHub expression.
    const secret = "    env:\n      TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n    steps:\n      - run: true\n";
    const env = "    environment: production\n";
    const gate = `    ${GATE_IF}\n`;
    const planted = (body: string) => `  planted:\n    runs-on: ubuntu-24.04\n${body}`;
    for (const body of [oidc, secret]) {
      expect(problems(withJob(planted(body)))).toHaveLength(1);
      expect(problems(withJob(planted(env + body)))).toHaveLength(1);
      expect(problems(withJob(planted(gate + body)))).toHaveLength(1);
      expect(problems(withJob(planted(env + gate + body)))).toEqual([]);
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: planted workflow text with a GitHub expression.
    expect(problems(withJob(planted("    env:\n      T: ${{ secrets.GITHUB_TOKEN }}\n")))).toEqual([]);
    for (const other of ["secrets['DEPLOY_TOKEN']", "toJSON(secrets)"]) {
      expect(problems(withJob(planted(`    env:\n      T: ${expr(other)}\n`)))).toHaveLength(1);
    }
  });

  test("banned_triggers", () => {
    expect(problems(ci.replace("  pull_request:\n", "  pull_request_target:\n"))).toEqual([
      expect.stringMatching(/banned trigger$/),
    ]);
    expect(problems(ci.replace("  pull_request:\n", "  workflow_run:\n"))).toHaveLength(1);
  });

  test("no_expression_in_run", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the planted workflow text contains an expression.
    const single = '    steps:\n      - run: echo "${{ github.head_ref }}"\n';
    // biome-ignore lint/suspicious/noTemplateCurlyInString: as above, inside a block scalar.
    const block = "    steps:\n      - run: |\n          echo hi\n          echo ${{ github.head_ref }}\n";
    expect(problems(withJob(job(single)))).toHaveLength(1);
    expect(problems(withJob(job(block)))).toHaveLength(1);
    expect(problems(withJob(job(`    steps:\n      - run: "a #' ${expr("github.head_ref")}"\n`)))).toHaveLength(1);
    expect(problems(withJob(job(`    steps:\n      - "run": echo ${expr("github.head_ref")}\n`)))).toHaveLength(1);
  });

  test("main_runs_not_cancelled", () => {
    expect(ci).toContain(PR_ONLY_CANCEL);
    expect(ci).not.toMatch(/cancel-in-progress:\s*true/);
  });

  test("required_checks_listed", () => {
    const required: string[] = JSON.parse(readFileSync(join(ROOT, ".github", "required-checks.json"), "utf8"));
    expect(required).toEqual(["check", "audit", "secrets", "actionlint", "semgrep"]);
    const ids = [...jobs(code(ci)).keys()];
    for (const name of required) expect(ids).toContain(name);
  });
});

describe("audit scope override", () => {
  // Architecture ruling 2026-10-05 00:00Z (P0.07, P0-A5): only the audit job's read-only `npm audit signatures`
  // points the @unset scope at the public registry, for its signing-key fetch; every install stays fail-closed.
  test("audit_override_only_in_audit_job", () => {
    const lines = ci.split("\n");
    const hits = lines.flatMap((line, i) => (line.includes("@unset:registry=") ? [i] : []));
    expect(hits).toHaveLength(1);
    const at = hits[0] ?? -1;
    expect(lines[at]).toMatch(/^ {6}- run: npm audit signatures --@unset:registry=https:\/\/registry\.npmjs\.org\/$/);
    expect(lines.slice(0, at).findLast((line) => /^ {2}[\w-]+:$/.test(line))).toBe("  audit:");
  });
});
