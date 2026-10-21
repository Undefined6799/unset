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
    expect(problems(readFileSync(join(WORKFLOWS, file), "utf8"), file)).toEqual([]);
  });

  test("all_actions_sha_pinned", () => {
    expect(problems(withJob(job("    steps:\n      - uses: actions/checkout@v7\n")))).toHaveLength(1);
    expect(problems(withJob(job(`    steps:\n      - uses: someone/action@${"a".repeat(40)}\n`)))).toHaveLength(1);
    expect(problems(withJob(job("    container: node:26\n")))).toHaveLength(1);
    expect(problems(withJob(job("    env:\n      X_IMAGE: alpine:3\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: docker run --rm alpine:3 true\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: docker create alpine:3\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: podman container run alpine:3\n")))).toHaveLength(1);
    // A BuildKit container builder pulls its image: unnamed or by tag fails; by digest or a pinned variable passes.
    const builder = (opts: string) => withJob(job(`    steps:\n      - run: docker buildx create --use ${opts}\n`));
    expect(problems(builder("--driver docker-container"))).toHaveLength(1);
    expect(problems(builder('--driver-opt "image=moby/buildkit:v0.34.0"'))).toHaveLength(1);
    expect(problems(builder(`--driver-opt "image=moby/buildkit:v0.34.0@sha256:${"a".repeat(64)}"`))).toEqual([]);
    expect(problems(builder('--driver-opt "image=$BUILDKIT_IMAGE"'))).toEqual([]);
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
      "job planted: id-token: write outside a signing job",
    ]);
  });

  test("secrets_and_oidc_gated", () => {
    const oidc = "    permissions:\n      id-token: write\n    steps:\n      - run: true\n";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: planted workflow text with a GitHub expression.
    const secret = "    env:\n      TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n    steps:\n      - run: true\n";
    const env = "    environment: production\n";
    const gate = `    ${GATE_IF}\n`;
    const planted = (body: string) => `  planted:\n    runs-on: ubuntu-24.04\n${body}`;
    // The gate alone; OIDC outside the two signing jobs is its own problem, tested under "signing jobs" below.
    const gateProblems = (text: string) => problems(text).filter((p) => !p.endsWith("outside a signing job"));
    for (const body of [oidc, secret]) {
      expect(gateProblems(withJob(planted(body)))).toHaveLength(1);
      expect(gateProblems(withJob(planted(env + body)))).toHaveLength(1);
      expect(gateProblems(withJob(planted(gate + body)))).toHaveLength(1);
      expect(gateProblems(withJob(planted(env + gate + body)))).toEqual([]);
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

  // P0.09l (Alex 2026-10-05 20:34Z): drafts are checked locally with `npm run check`; GitHub runs the checks once a
  // PR is ready. A job whose `if:` is false is marked skipped (github/docs workflow-syntax.md, jobs.<job_id>.if), and
  // marking a PR ready fires `ready_for_review`, which runs only when listed in `types` (events-that-trigger-workflows.md).
  const prWorkflows = workflowFiles.filter((f) => /^ {2}pull_request:/m.test(readFileSync(join(WORKFLOWS, f), "utf8")));

  test.each(prWorkflows)("draft_pr_skips_jobs %s", (file) => {
    for (const [id, lines] of jobs(code(readFileSync(join(WORKFLOWS, file), "utf8")))) {
      const condition = lines.find((l) => /^ {4}if: /.test(l)) ?? "";
      expect(condition, `${file} job ${id}`).toContain("github.event.pull_request.draft == false");
    }
  });

  test.each(prWorkflows)("ready_for_review_triggers %s", (file) => {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    expect(text).toMatch(/^ {4}types: \[[^\]]*\bready_for_review\b[^\]]*\]$/m);
  });

  test("main_push_unchanged", () => {
    expect(ci).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    // Every ci.yml job runs on any event that is not a pull request, so a push to main still runs everything.
    for (const [id, lines] of jobs(code(ci))) {
      const condition = lines.find((l) => /^ {4}if: /.test(l)) ?? "";
      expect(condition, `ci.yml job ${id}`).toMatch(/^ {4}if: github\.event_name != 'pull_request' \|\| /);
    }
  });

  test("required_checks_listed", () => {
    const required: string[] = JSON.parse(readFileSync(join(ROOT, ".github", "required-checks.json"), "utf8"));
    // The P0.07 gate set, P0.09c's pr-shape, and P1.26's e2e job. Alex updates the ruleset to match.
    expect(required).toEqual(["check", "audit", "secrets", "actionlint", "semgrep", "pr-shape", "e2e"]);
    const ids = workflowFiles.flatMap((f) => [...jobs(code(readFileSync(join(WORKFLOWS, f), "utf8"))).keys()]);
    for (const name of required) expect(ids).toContain(name);
  });
});

// P1.27s (ADR 0033; Alex's typed line 2026-10-20 21:57:26Z): packages: write and id-token: write belong to the two
// signing jobs alone, each gated and in the signing environment; publish-images.yml never runs on a pull request and
// never reads a cache.
describe("signing jobs (P1.27s)", () => {
  const publish = readFileSync(join(WORKFLOWS, "publish-images.yml"), "utf8");
  const mirror = readFileSync(join(WORKFLOWS, "mirror.yml"), "utf8");
  const PACKAGES = "      packages: write\n";

  test("packages_write_gated_publish_passes", () => {
    expect(problems(publish, "publish-images.yml")).toEqual([]);
    expect(problems(mirror, "mirror.yml")).toEqual([]);
  });

  test("packages_write_ungated_fails", () => {
    const ungatedIf = publish.replace(`    ${GATE_IF}\n`, "    if: github.ref == 'refs/heads/main'\n");
    expect(problems(ungatedIf, "publish-images.yml")).toEqual([
      expect.stringMatching(/^job publish: secret or OIDC outside an environment-bound main-only job$/),
    ]);
    const noEnvironment = publish.replace("    environment: signing\n", "");
    expect(problems(noEnvironment, "publish-images.yml")).toEqual([
      "job publish: secret or OIDC outside an environment-bound main-only job",
      "job publish: a signing job not in the signing environment",
    ]);
    const otherEnvironment = publish.replace("    environment: signing\n", "    environment: production\n");
    expect(problems(otherEnvironment, "publish-images.yml")).toEqual([
      "job publish: a signing job not in the signing environment",
    ]);
    // Gated without OIDC, packages: write still counts as privileged.
    const packagesOnly = publish.replace("    environment: signing\n", "").replace("      id-token: write\n", "");
    expect(problems(packagesOnly, "publish-images.yml")).toContain(
      "job publish: secret or OIDC outside an environment-bound main-only job",
    );
  });

  test("packages_write_other_job_fails", () => {
    const scan = mirror.replace(
      "    permissions:\n      contents: read\n    env:\n      MIRROR_LIST",
      `    permissions:\n      contents: read\n${PACKAGES}    env:\n      MIRROR_LIST`,
    );
    expect(problems(scan, "mirror.yml")).toContain("job scan: packages: write outside a signing job");
    const renamed = publish.replace("  publish:\n", "  release:\n");
    expect(problems(renamed, "publish-images.yml")).toEqual([
      "job release: id-token: write outside a signing job",
      "job release: packages: write outside a signing job",
      "publish-images.yml has a job other than publish",
    ]);
    const flow = publish
      .replace(
        `      contents: read\n${PACKAGES}      id-token: write\n`,
        "      contents: read\n      id-token: write\n",
      )
      .replace("    permissions:\n", "    permissions: { packages: write }\n    perms:\n");
    expect(problems(flow, "publish-images.yml")).toContain("job publish: packages: write not at job level");
    const topLevel = publish.replace("permissions: {}\n", `permissions: {}\nx-permissions:\n${PACKAGES}`);
    expect(problems(topLevel, "publish-images.yml")).toContain("a workflow-level id-token or packages write");
  });

  test("packages_write_other_file_fails", () => {
    for (const file of ["images.yml", "ci.yml", "publish-images.yaml", ""]) {
      expect(problems(publish, file), file).toEqual([
        "job publish: id-token: write outside a signing job",
        "job publish: packages: write outside a signing job",
      ]);
    }
  });

  test("id_token_write_only_on_signing_jobs", () => {
    // Gated and in the signing environment, but not one of the two signing jobs.
    const planted = `  planted:\n    ${GATE_IF}\n    environment: signing\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n      id-token: write\n`;
    expect(problems(withJob(planted), "ci.yml")).toEqual(["job planted: id-token: write outside a signing job"]);
    const images = readFileSync(join(WORKFLOWS, "images.yml"), "utf8");
    expect(problems(images, "images.yml")).toEqual([]);
    expect(code(images).join("\n")).not.toMatch(/id-token|packages: write/);
    // Exactly the two signing jobs hold it today.
    const holders = readdirSync(WORKFLOWS).flatMap((file) =>
      [...jobs(code(readFileSync(join(WORKFLOWS, file), "utf8")))]
        .filter(([, body]) => body.some((l) => /id-token:\s*write/.test(l)))
        .map(([id]) => `${file} ${id}`),
    );
    expect(holders.sort()).toEqual(["mirror.yml copy-and-sign", "publish-images.yml publish"]);
  });

  test("publish_images_pull_request_trigger_fails", () => {
    for (const trigger of ["  pull_request:\n", "  pull_request:\n    types: [opened]\n"]) {
      const text = publish.replace("  workflow_dispatch:\n", `  workflow_dispatch:\n${trigger}`);
      expect(problems(text, "publish-images.yml")).toEqual(["publish-images.yml has a pull_request trigger"]);
    }
    expect(problems(publish.replace("on:\n", "on: [pull_request]\nx:\n"), "publish-images.yml")).toContain(
      "publish-images.yml has a pull_request trigger",
    );
  });

  test("publish_job_cache_fails", () => {
    const setupNode = "          node-version-file: .nvmrc\n";
    for (const cache of [
      `${setupNode}          cache: npm\n`,
      `${setupNode}      - uses: actions/cache@${"a".repeat(40)}\n`,
    ]) {
      const found = problems(publish.replace(setupNode, cache), "publish-images.yml");
      expect(found).toContain("job publish: a cache in a signing job");
      expect(found).toContain("publish-images.yml uses a cache");
    }
    const from = publish.replace("--metadata-file", "--cache-from type=gha --metadata-file");
    expect(problems(from, "publish-images.yml")).toContain("job publish: a cache in a signing job");
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
