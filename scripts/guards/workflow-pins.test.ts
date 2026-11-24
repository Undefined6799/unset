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
    // P0.07m: actions/cache's restore and save folders pass at a SHA; no other sub-path, and not at a tag.
    for (const sub of ["cache/restore", "cache/save"]) {
      expect(problems(withJob(job(`    steps:\n      - uses: actions/${sub}@${"a".repeat(40)}\n`)))).toEqual([]);
      expect(problems(withJob(job(`    steps:\n      - uses: actions/${sub}@v6\n`)))).toHaveLength(1);
    }
    for (const sub of ["cache/other", "checkout/restore", "cache/../evil", "cache/restore/x"]) {
      expect(problems(withJob(job(`    steps:\n      - uses: actions/${sub}@${"a".repeat(40)}\n`))), sub).toHaveLength(
        1,
      );
    }
    expect(problems(withJob(job("    container: node:26\n")))).toHaveLength(1);
    expect(problems(withJob(job("    env:\n      X_IMAGE: alpine:3\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: docker run --rm alpine:3 true\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: docker create alpine:3\n")))).toHaveLength(1);
    expect(problems(withJob(job("    steps:\n      - run: podman container run alpine:3\n")))).toHaveLength(1);
    // P2.24c: the pull of `$ref` passes only in publish-images.yml, right after the lines that set and check it.
    const checked = [
      'ref="$REGISTRY/$name@$(jq -r \'."containerimage.digest"\' "$RUNNER_TEMP/meta.json")"',
      `case "$ref" in *@sha256:${"?".repeat(64)}) ;; *) exit 1 ;; esac`,
    ];
    // Only the pin problem counts here: the CI fixture breaks publish-images.yml's own trigger and job rules.
    const pull = (lines: string[], file = "publish-images.yml") =>
      problems(
        withJob(job(`    steps:\n      - run: |\n${lines.map((l) => `          ${l}\n`).join("")}`)),
        file,
      ).filter((problem) => problem.endsWith("container started without a digest-pinned image"));
    const exact = 'docker pull --quiet --platform linux/amd64 "$ref" > /dev/null';
    expect(pull([...checked, exact])).toEqual([]);
    expect(pull([...checked, "# a comment", exact])).toEqual([]);
    expect(pull([...checked, exact], "images.yml")).toHaveLength(1);
    expect(pull(["ref=alpine:latest", exact])).toHaveLength(1);
    expect(pull([...checked, "ref=alpine:latest", exact])).toHaveLength(1);
    expect(pull([checked[0] ?? "", exact])).toHaveLength(1);
    expect(pull([...checked, 'docker pull --quiet --platform linux/amd64 "$other" > /dev/null'])).toHaveLength(1);
    expect(pull([...checked, 'docker pull "$ref"'])).toHaveLength(1);
    expect(pull([...checked, 'docker run --rm "$ref"'])).toHaveLength(1);
    // The set, the check and the pull must share one run block, so one shell (Codex on #1276).
    const steps = (first: string[], second: string) =>
      problems(
        withJob(
          job(
            `    env:\n      ref: alpine:latest\n    steps:\n      - run: |\n${first.map((l) => `          ${l}\n`).join("")}      - run: |\n          ${second}\n`,
          ),
        ),
        "publish-images.yml",
      ).filter((problem) => problem.endsWith("container started without a digest-pinned image"));
    expect(steps(checked, exact)).toHaveLength(1);
    expect(steps(checked, `run: ${exact}`)).toHaveLength(1);
    const oneLine = withJob(
      job(`    steps:\n      - run: |\n${checked.map((l) => `          ${l}\n`).join("")}      - run: ${exact}\n`),
    );
    expect(problems(oneLine, "publish-images.yml").filter((p) => p.endsWith("digest-pinned image"))).toHaveLength(1);
    expect(pull([...checked.map((l) => `  ${l}`), exact])).toHaveLength(1);
    // A BuildKit container builder pulls its image: unnamed or by tag fails; by digest or a pinned variable passes.
    const builder = (opts: string) => withJob(job(`    steps:\n      - run: docker buildx create --use ${opts}\n`));
    expect(problems(builder("--driver docker-container"))).toHaveLength(1);
    expect(problems(builder('--driver-opt "image=moby/buildkit:v0.34.0"'))).toHaveLength(1);
    expect(problems(builder(`--driver-opt "image=moby/buildkit:v0.34.0@sha256:${"a".repeat(64)}"`))).toEqual([]);
    expect(problems(builder('--driver-opt "image=$BUILDKIT_IMAGE"'))).toEqual([]);
    // P1.27t: the literal default-load option may stand beside it, and nothing may ride on it.
    expect(problems(builder('--driver-opt "image=$BUILDKIT_IMAGE" --driver-opt default-load=true'))).toEqual([]);
    expect(problems(builder('--driver-opt default-load=true --driver-opt "image=$BUILDKIT_IMAGE"'))).toEqual([]);
    expect(
      problems(
        builder('--driver-opt "image=$BUILDKIT_IMAGE" --driver-opt default-load=true,image=moby/buildkit:latest'),
      ),
    ).toHaveLength(1);
    expect(problems(builder('--driver-opt "image=$BUILDKIT_IMAGE" --driver-opt default-load=false'))).toHaveLength(1);
    // The last image= wins in buildx's driver options, so exactly one may appear, and a digest cannot ride a CSV tail.
    const pinned = `moby/buildkit:v0.34.0@sha256:${"a".repeat(64)}`;
    expect(
      problems(builder(`--driver-opt "image=moby/buildkit:latest,env.PIN=x@sha256:${"a".repeat(64)}"`)),
    ).toHaveLength(1);
    expect(
      problems(builder(`--driver-opt "image=$BUILDKIT_IMAGE" --driver-opt "image=moby/buildkit:latest"`)),
    ).toHaveLength(1);
    expect(problems(builder(`--driver-opt "image=${pinned},image=moby/buildkit:latest"`))).toHaveLength(1);
    // One fixed shape: the equals form, unquoted values and any `$` the shell expands beyond the image variable fail.
    expect(problems(builder(`--driver-opt=image=${pinned}`))).toHaveLength(1);
    expect(problems(builder(`--driver-opt image=${pinned}`))).toHaveLength(1);
    expect(problems(builder(`--name "$NAME" --driver-opt "image=${pinned}"`))).toHaveLength(1);
    // Quotes built at run time (Codex on #1206): the shell hands buildx one CSV-quoted env option and no image.
    expect(problems(builder(`--driver-opt "\${Q}env.X=a,image=${pinned}\${Q}"`))).toHaveLength(1);
    expect(problems(builder(`--driver-opt "$Q"env.X=a,image=${pinned}"$Q"`))).toHaveLength(1);
    expect(problems(builder(`--name publish --driver docker-container --driver-opt "image=${pinned}"`))).toEqual([]);
    // Only `--use` stands alone; every other flag takes a value that never starts with `-` (verify of #1243).
    expect(problems(builder(`--driver-opt --name --driver-opt "image=${pinned}"`))).toHaveLength(1);
    expect(problems(builder(`--name -x --driver-opt "image=${pinned}"`))).toHaveLength(1);
    // pflag takes `--driver-opt` as `--name`'s value here, so the image becomes a positional argument and BuildKit runs
    // its default, unpinned image.
    expect(problems(builder(`--name --driver-opt "image=${pinned}"`))).toHaveLength(1);
    // A refused line is refused quickly. When a value could also read as a flag, 44 `--a` options after `--use` took
    // the old pattern about 2.2 s to refuse, doubling every few options; a value now never starts with `-`, and the
    // option groups are bounded.
    const started = performance.now();
    expect(problems(builder(`--a${" --a".repeat(43)}!`))).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(200);
    expect(problems(builder(`--driver-opt "env.X=image=${pinned}"`))).toHaveLength(1);
    // The equals form is a whole option, never the tail of another option's value.
    expect(problems(builder(`--driver-opt "env.X--driver-opt=image=${pinned}"`))).toHaveLength(1);
    // A `"` inside a value is CSV quoting to buildx, so a quoted field can carry a comma and hide the image from it.
    expect(problems(builder(`--driver-opt '"env.X=a,image=${pinned}"'`))).toHaveLength(1);
    expect(problems(builder(`--driver-opt "\\"env.X=a,image=${pinned}\\""`))).toHaveLength(1);
    // An escaped quote with no single quote on the line: the image ends at a `"`, so only the `\\"` rule refuses it.
    expect(problems(builder(`--driver-opt "\\"env.X=a,image=${pinned}"\\"`))).toHaveLength(1);
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

  // P0.07l (Alex 2026-11-18 11:38Z): only the cheap checks also run on drafts: ci.yml's `code` job (typecheck,
  // lint, guards, unit tests) and pr-shape. Every other job still waits for ready.
  const DRAFT_JOBS = new Set(["ci.yml code", "pr-shape.yml pr-shape"]);

  test.each(prWorkflows)("draft_pr_skips_jobs %s", (file) => {
    for (const [id, lines] of jobs(code(readFileSync(join(WORKFLOWS, file), "utf8")))) {
      if (DRAFT_JOBS.has(`${file} ${id}`)) continue;
      const condition = lines.find((l) => /^ {4}if: /.test(l)) ?? "";
      expect(condition, `${file} job ${id}`).toContain("github.event.pull_request.draft == false");
    }
  });

  test("draft_jobs_listed_exist", () => {
    for (const entry of DRAFT_JOBS) {
      const [file = "", id = ""] = entry.split(" ");
      expect(jobs(code(readFileSync(join(WORKFLOWS, file), "utf8"))).has(id), entry).toBe(true);
    }
  });

  test.each(prWorkflows)("ready_for_review_triggers %s", (file) => {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    expect(text).toMatch(/^ {4}types: \[[^\]]*\bready_for_review\b[^\]]*\]$/m);
  });

  test("main_push_unchanged", () => {
    expect(ci).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    // Every ci.yml job runs on any event that is not a pull request, so a push to main still runs everything. The
    // check gate (P0.07d) adds always() in front, so it also runs when a need failed. The code job has no if at all
    // (P0.07l), so it runs on every event.
    for (const [id, lines] of jobs(code(ci))) {
      const condition = lines.find((l) => /^ {4}if: /.test(l)) ?? "";
      if (id === "code") {
        expect(condition, "ci.yml job code").toBe("");
        continue;
      }
      const gate =
        id === "check" ? /^ {4}if: always\(\) && \(github\.event_name != 'pull_request' \|\| [^)]*\)$/ : null;
      expect(condition, `ci.yml job ${id}`).toMatch(gate ?? /^ {4}if: github\.event_name != 'pull_request' \|\| /);
    }
  });

  test("required_checks_listed", () => {
    const required: string[] = JSON.parse(readFileSync(join(ROOT, ".github", "required-checks.json"), "utf8"));
    // The P0.07 gate set, P0.09c's pr-shape, P1.26's e2e job, and P0.09's docs-site job.
    // Alex updates the ruleset to match.
    expect(required).toEqual(["check", "audit", "secrets", "actionlint", "semgrep", "pr-shape", "e2e", "docs-site"]);
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
      "publish-images.yml has a job other than publish and bump",
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
        // The pushed-digest pull is accepted only in publish-images.yml.
        expect.stringMatching(/^line \d+: container started without a digest-pinned image$/),
        // P2.26m: the bump job's two writes pass only in publish-images.yml.
        "write permission: contents: write",
        "write permission: pull-requests: write",
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

  // P2.26m (Alex's typed line, in the PR): after publish, the bump job opens the lock-bump pull request. It is the one
  // job outside docs-auto-merge.yml with contents: write and pull-requests: write, and only in this exact shape.
  test("bump_job_shape_is_pinned", () => {
    const bump = publish.slice(publish.indexOf("  bump:\n"));
    const changed = (from: string, to: string) => {
      expect(bump, from).toContain(from);
      return problems(publish.replace(bump, bump.replace(from, to)), "publish-images.yml");
    };
    const CHANGED = "bump job is not the reviewed job (update BUMP_JOB_LINES with the change)";
    const run = "        run: node scripts/ci/lock-bump-pr.ts\n";
    const checkout = "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n";
    const cases: [string, string][] = [
      ["    needs: publish\n", ""],
      [`    ${GATE_IF}\n`, "    if: always()\n"],
      ["      pull-requests: write\n", ""],
      ["      pull-requests: write\n", "      pull-requests: write\n      actions: write\n"],
      ["          persist-credentials: false\n", ""],
      ["          ref: ${{ github.sha }}\n", "          ref: main\n"],
      [run, "        run: node scripts/ci/lock-bump-pr.ts && git push\n"],
      [run, `${run}      - run: gh pr merge\n`],
      [run, `${run}        shell: bash -c "gh pr merge; {0}"\n`],
      [run, `${run}        working-directory: /tmp\n`],
      [
        "          PUBLISHED_LOCK: ${{ needs.publish.outputs.lock }}\n",
        "          PUBLISHED_LOCK: ${{ github.event.head_commit.message }}\n",
      ],
      // What a rule read line by line would miss: a job environment (its secrets), a container, job defaults,
      // another env or with key, another action, and the same keys quoted.
      ["    runs-on: ubuntu-24.04\n", "    runs-on: ubuntu-24.04\n    environment: signing\n"],
      ["    runs-on: ubuntu-24.04\n", "    runs-on: ubuntu-24.04\n    container: ghcr.io/evil/image\n"],
      ["    runs-on: ubuntu-24.04\n", "    runs-on: ubuntu-24.04\n    defaults:\n      run:\n        shell: sh\n"],
      ["    runs-on: ubuntu-24.04\n", "    runs-on: ubuntu-24.04\n    env:\n      NODE_OPTIONS: --require ./x.js\n"],
      ["      - env:\n", "      - env:\n          NODE_OPTIONS: --require ./x.js\n"],
      ["          package-manager-cache: false\n", "          package-manager-cache: false\n          token: x\n"],
      [
        "          persist-credentials: false\n",
        "          persist-credentials: false\n          repository: evil/x\n",
      ],
      [
        "      - env:\n",
        "      - uses: actions/upload-artifact@0123456789012345678901234567890123456789\n      - env:\n",
      ],
      ["      - env:\n", '      - "uses": evil/action@0123456789012345678901234567890123456789\n      - env:\n'],
      [checkout, checkout.replace("uses:", '"uses":')],
      [checkout, checkout.replace("actions/checkout", "evil/checkout")],
      [run, run.replace("run:", '"run":')],
    ];
    for (const [from, to] of cases) expect(changed(from, to), to).toContain(CHANGED);
    expect(problems(`defaults:\n  run:\n    shell: sh\n${publish}`, "publish-images.yml")).toContain(
      "publish-images.yml sets workflow defaults",
    );
    // A quoted write is still a write: refused on publish, and in any other workflow.
    for (const quoted of [
      '      "contents": write\n',
      "      contents: 'write'\n",
      '      "pull-requests": "write"\n',
    ]) {
      const moved = publish.replace("      packages: write\n", `      packages: write\n${quoted}`);
      expect(problems(moved, "publish-images.yml"), quoted).toContain("a merge write outside the bump job");
      expect(problems(moved, "ci.yml"), quoted).toContain(`write permission: ${quoted.trim()}`);
    }
    // It cannot sign: the signing scopes and the signing environment's secrets stay with publish.
    expect(changed("      contents: write\n", "      contents: write\n      id-token: write\n")).toContain(
      "job bump: id-token: write outside a signing job",
    );
    expect(changed("      contents: write\n", "      contents: write\n      packages: write\n")).toContain(
      "job bump: packages: write outside a signing job",
    );
    // The same writes on the publish job, or on any third job, are refused.
    const onPublish = publish.replace("      packages: write\n", "      packages: write\n      contents: write\n");
    expect(problems(onPublish, "publish-images.yml")).toContain("a merge write outside the bump job");
    const third = `${publish}  other:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: write\n`;
    expect(problems(third, "publish-images.yml")).toEqual([
      "a merge write outside the bump job",
      "publish-images.yml has a job other than publish and bump",
    ]);
    // Without the bump job the file passes, and the writes pass nowhere else.
    expect(problems(publish.replace(bump, ""), "publish-images.yml")).toEqual([]);
    const renamed = publish.replace("  bump:\n", "  release:\n");
    expect(problems(renamed, "publish-images.yml")).toEqual([
      "write permission: contents: write",
      "write permission: pull-requests: write",
      "publish-images.yml has a job other than publish and bump",
    ]);
  });

  test("publish_images_pull_request_trigger_fails", () => {
    for (const trigger of ["  pull_request:\n", "  pull_request:\n    types: [opened]\n"]) {
      const text = publish.replace("    branches: [main]\n", `    branches: [main]\n${trigger}`);
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
      // P0.07m (Codex on #1715): the sub-actions the pin rule now accepts are caches too.
      `${setupNode}      - uses: actions/cache/restore@${"a".repeat(40)}\n`,
      `${setupNode}      - uses: actions/cache/save@${"a".repeat(40)}\n`,
    ]) {
      const found = problems(publish.replace(setupNode, cache), "publish-images.yml");
      expect(found).toContain("job publish: a cache in a signing job");
      expect(found).toContain("publish-images.yml uses a cache");
    }
    const from = publish.replace("--metadata-file", "--cache-from type=gha --metadata-file");
    expect(problems(from, "publish-images.yml")).toContain("job publish: a cache in a signing job");
  });

  // P0.07m (Codex on #1715): every form of actions/cache is refused in both signing jobs.
  test("signing_job_cache_action_fails_in_every_form", () => {
    const off = "          package-manager-cache: false\n";
    for (const [file, text, id] of [
      ["publish-images.yml", publish, "publish"],
      ["mirror.yml", mirror, "copy-and-sign"],
    ] as const) {
      for (const action of ["cache", "cache/restore", "cache/save"]) {
        const changed = text.replace(off, `${off}      - uses: actions/${action}@${"a".repeat(40)}\n`);
        expect(changed, `${file} ${action}`).not.toBe(text);
        expect(problems(changed, file), `${file} ${action}`).toContain(`job ${id}: a cache in a signing job`);
      }
    }
  });

  test("signing_job_setup_node_cache_off", () => {
    // setup-node v7 caches npm on its own unless told not to (verify-1150 S3), so both signing jobs say so by name.
    const off = "          package-manager-cache: false\n";
    for (const [file, text, id] of [
      ["publish-images.yml", publish, "publish"],
      ["mirror.yml", mirror, "copy-and-sign"],
    ] as const) {
      expect(text).toContain(off);
      for (const changed of [text.replace(off, ""), text.replace(off, "          package-manager-cache: true\n")]) {
        expect(problems(changed, file)).toContain(
          `job ${id}: setup-node without package-manager-cache: false in a signing job`,
        );
      }
    }
    // Every setup-node step needs it inside its own lines: a bare step after the real one, and a bare step before it
    // (whose lines must stop at the next step, not run on into the real one's), each fail.
    // Read from the workflow, so a Renovate bump of the pin keeps this case real.
    const step = `${publish.split("\n").find((l) => l.includes("- uses: actions/setup-node@"))}\n`;
    const second = `${step}        with:\n          node-version-file: .nvmrc\n`;
    for (const twice of [publish.replace(off, `${off}${second}`), publish.replace(step, `${second}${step}`)]) {
      expect(twice).not.toBe(publish);
      expect(problems(twice, "publish-images.yml")).toContain(
        "job publish: setup-node without package-manager-cache: false in a signing job",
      );
    }
    // Quoted YAML is the same step (Codex on #1206), and the key counts only as an action input under `with:`.
    const uses = step.trim().slice(2).split(" #")[0] as string;
    const quotedValue = second.replace(uses, uses.replace(/: (.*)$/, ': "$1"'));
    const quotedKey = second.replace("- uses:", '- "uses":');
    const named = `      - name: Node\n        uses: ${uses.slice("uses: ".length)}\n        with:\n          node-version-file: .nvmrc\n`;
    const inEnv = `${step}        env:\n          package-manager-cache: false\n        with:\n          node-version-file: .nvmrc\n`;
    for (const extra of [quotedValue, quotedKey, named, inEnv]) {
      expect(problems(publish.replace(off, `${off}${extra}`), "publish-images.yml"), extra).toContain(
        "job publish: setup-node without package-manager-cache: false in a signing job",
      );
    }
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
    // P0.07p: the step runs the command through scripts/ci/npm-audit-signatures.ts, which hands npm these arguments.
    expect(lines[at]).toBe(
      "      - run: node scripts/ci/npm-audit-signatures.ts --@unset:registry=https://registry.npmjs.org/",
    );
    expect(lines.slice(0, at).findLast((line) => /^ {2}[\w-]+:$/.test(line))).toBe("  audit:");
  });
});

// P0.07e: workflow_run and the two merge writes exist only in docs-auto-merge.yml, which checks out
// the default branch (github.sha) and runs one script. A pull_request trigger there would execute the
// pull request's copy of the workflow with the write token.
describe("docs auto-merge (P0.07e)", () => {
  const file = "docs-auto-merge.yml";
  const text = readFileSync(join(WORKFLOWS, file), "utf8");

  test("auto_merge_workflow_is_the_only_privileged_shape", () => {
    expect(problems(text, file)).toEqual([]);
    const elsewhere = problems(text, "ci.yml");
    expect(elsewhere.some((problem) => problem.endsWith("banned trigger"))).toBe(true);
    expect(elsewhere).toContain("write permission: contents: write");
    expect(elsewhere).toContain("write permission: pull-requests: write");
  });

  test("docs_only_runs_only_with_kind_docs", () => {
    const docsOnly = readFileSync(join(WORKFLOWS, "docs-only.yml"), "utf8");
    const types = docsOnly.match(/^ {4}types: \[([^\]]+)\]$/m)?.[1] ?? "";
    for (const type of ["opened", "synchronize", "reopened", "ready_for_review", "labeled", "unlabeled"]) {
      expect(
        types.split(",").map((part) => part.trim()),
        type,
      ).toContain(type);
    }
    const condition =
      jobs(code(docsOnly))
        .get("docs-only")
        ?.find((line) => /^ {4}if: /.test(line)) ?? "";
    expect(condition).toContain("github.event.pull_request.draft == false");
    expect(condition).toContain("contains(github.event.pull_request.labels.*.name, 'kind/docs')");
  });

  test("auto_merge_rejects_pull_request_code", () => {
    const pullRequest = text.replace("  workflow_run:\n", "  workflow_run:\n  pull_request:\n");
    expect(problems(pullRequest, file)).toContain("docs auto-merge workflow has a pull request trigger");
    const target = text.replace("  workflow_run:\n", "  pull_request_target:\n");
    expect(problems(target, file).some((problem) => problem.endsWith("banned trigger"))).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: planted workflow text with a GitHub expression.
    const head = text.replace("ref: ${{ github.sha }}", "ref: ${{ github.event.workflow_run.head_sha }}");
    expect(problems(head, file)).toContain("docs auto-merge checkout ref is not github.sha");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: planted workflow text with a GitHub expression.
    const unsafe = text.replace("ref: ${{ github.sha }}", "ref: ${{ github.event.pull_request.head.sha }}");
    expect(problems(unsafe, file).some((problem) => problem.includes("untrusted input"))).toBe(true);
  });
});

// P1.38r: issues: write exists only in waivers.yml, on its notify job, and only while that file is byte for byte
// the reviewed one (the guard names it by SHA-256). The job that runs npm ci stays read-only.
describe("waivers notify (P1.38r)", () => {
  const file = "waivers.yml";
  const text = readFileSync(join(WORKFLOWS, file), "utf8");
  const NOT_REVIEWED = "waivers.yml is not the reviewed file (update WAIVERS_SHA256 with the change)";
  const RUN = "      - run: |\n";

  test("issues_write_only_in_the_reviewed_waivers_file", () => {
    expect(text.match(/^\s+issues: write$/gm)).toHaveLength(1);
    expect(text).toContain("  notify:\n    needs: expiry\n    if: failure()\n");
    expect(text).toContain("    permissions:\n      issues: write\n    env:\n");
    expect(problems(text, file)).toEqual([]);
    expect(problems(text, "ci.yml")).toContain("write permission: issues: write");
  });

  test("any_edit_to_the_waivers_workflow_fails_the_guard", () => {
    const changed = [
      text.replace("      contents: read\n", "      contents: read\n      issues: write\n"),
      text.replace("      issues: write\n", "      issues: write\n      contents: read\n"),
      text.replace(RUN, `      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n${RUN}`),
      // Codex on #1539: a list of banned command names let any other command through.
      text.replace('          body="The daily', '          python3 -c "print(1)"\n          body="The daily'),
      `${text}      - run: gh issue list\n`,
      // Codex on #1539: a custom shell runs its own command and ignores the checked script.
      text.replace(RUN, "      - shell: bash -c 'echo other' {0}\n        run: |\n"),
      text.replace("\njobs:\n", "\ndefaults:\n  run:\n    shell: python3 {0}\n\njobs:\n"),
      // Codex on #1539: a quoted key is the same key to YAML and was invisible to a key-name rule.
      text.replace("\njobs:\n", "\n\"defaults\":\n  run:\n    shell: bash -c 'echo other; exit 1' {0}\n\njobs:\n"),
      text.replace("\njobs:\n", "\nenv:\n  BASH_ENV: /tmp/x\n\njobs:\n"),
      text.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  issue_comment:\n"),
      `${text}\n`,
      // Dropping the permission does not unpin the file: a write spelled so the line rules miss it would otherwise pass.
      text.replace("      issues: write\n", "      issues: !!str write\n"),
    ];
    for (const workflow of changed) {
      expect(workflow).not.toBe(text);
      expect(problems(workflow, file)).toContain(NOT_REVIEWED);
    }
  });
});
