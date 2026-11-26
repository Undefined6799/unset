// The image workflows' own rules (P1.27q; keyless signing since P1.27s, ADR 0033), on top of the repository-wide
// workflow guard (scripts/guards/workflows.ts).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { listDockerfiles } from "./list-dockerfiles.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const FILES = ["images.yml", "mirror.yml", "publish-images.yml", "sigstore-root.yml"] as const;
/** The jobs that sign, and the permissions each holds: exactly these. */
const SIGNING: Record<string, Record<string, Record<string, string>>> = {
  "publish-images.yml": { publish: { contents: "read", packages: "write", "id-token": "write" } },
  "mirror.yml": { "copy-and-sign": { contents: "read", packages: "write", "id-token": "write" } },
};
const text = (file: string): string => readFileSync(join(ROOT, ".github", "workflows", file), "utf8");

type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string> };
type Job = {
  if?: string;
  permissions?: Record<string, string> | string;
  environment?: unknown;
  env?: Record<string, string>;
  steps?: Step[];
};
type Workflow = { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Job> };
const workflow = (file: string): Workflow => parse(text(file));

/**
 * Every cosign call that would skip the transparency log, sign or verify with a key, or match an identity by pattern
 * (ADR 0033, Decisions 2 and 3). cosign v3.1.3 uploads to Rekor and writes the bundle by default
 * (cmd/cosign/cli/options/sign.go and attest.go at the tag), so the rule is that no call turns either off.
 */
function cosignProblems(workflowText: string): string[] {
  const banned =
    /--tlog-upload=false|--insecure-ignore-tlog|--private-infrastructure|--use-signing-config=false|--key\b|-regexp\b|--offline\b/;
  return workflowText.split("\n").flatMap((line, i) => {
    const call = /\bcosign\s+([\w-]+)/.exec(line)?.[1];
    const flag = banned.exec(line)?.[0];
    return call !== undefined && flag !== undefined ? [`line ${i + 1}: cosign ${call} with ${flag}`] : [];
  });
}

describe("image workflows", () => {
  test.each(FILES)("workflow_permissions_minimal %s", (file) => {
    const wf = workflow(file);
    expect(wf.permissions).toEqual({});
    for (const [id, job] of Object.entries(wf.jobs)) {
      expect(job.permissions, `${file} job ${id}`).not.toBe("write-all");
      const signs = (job.steps ?? []).some((step) => /\bcosign\s+(sign|attest)\b/.test(step.run ?? ""));
      const signing = SIGNING[file]?.[id];
      // Only the two signing jobs sign, use the `signing` environment, and hold exactly their write scopes.
      expect(signs, `${file} job ${id}`).toBe(signing !== undefined);
      if (job.environment !== undefined)
        expect(signing !== undefined && job.environment === "signing", `${file} job ${id}`).toBe(true);
      if (signing !== undefined) {
        expect(job.environment, `${file} job ${id}`).toBe("signing");
        expect(job.permissions, `${file} job ${id}`).toEqual(signing);
      }
      // P1.34m: images.yml's pins job alone also reads packages, for the GHCR push time of a newly pinned base.
      const reads =
        file === "images.yml" && id === "pins" ? { contents: "read", packages: "read" } : { contents: "read" };
      // P2.26m: publish-images.yml's bump job opens the lock-bump pull request; it holds these two writes and no more.
      const bump = file === "publish-images.yml" && id === "bump";
      // P2.18t: mirror.yml's verdict job reads only its needed job's output, so it holds nothing.
      const verdict = file === "mirror.yml" && id === "verdict";
      const held = bump ? { contents: "write", "pull-requests": "write" } : verdict ? {} : reads;
      if (!signs) expect(job.permissions, `${file} job ${id}`).toEqual(held);
    }
  });

  // No cosign call in any workflow skips Rekor, uses a key or matches an identity by pattern (it replaces P1.27q's
  // no_tlog_upload_flag_present, which held the private-repository key design).
  test("tlog_upload_never_disabled", () => {
    const all = readdirSync(join(ROOT, ".github", "workflows"));
    for (const file of all) expect(cosignProblems(text(file)), file).toEqual([]);
    expect(cosignProblems('cosign sign --yes "$ref"')).toEqual([]);
    for (const [line, flag] of [
      ['cosign sign --yes --tlog-upload=false "$ref"', "--tlog-upload=false"],
      ["cosign attest --use-signing-config=false x", "--use-signing-config=false"],
      ["cosign verify --insecure-ignore-tlog=true x", "--insecure-ignore-tlog"],
      ["cosign verify --certificate-identity-regexp '.*' x", "-regexp"],
      ["cosign sign --key env://K x", "--key"],
    ] as const) {
      expect(cosignProblems(line)).toEqual([`line 1: cosign ${line.split(" ")[1]} with ${flag}`]);
    }
  });

  // One digest (book edit 2026-10-15-verify-863-866-followups, N7): publish pushes by digest, then scans, signs,
  // attests and locks that same ref, and verifies the lock it wrote; it never signs a tag.
  test("publish_signs_the_digest_it_pushed", () => {
    const steps = workflow("publish-images.yml").jobs.publish?.steps ?? [];
    const run = steps.map((step) => step.run ?? "").join("\n");
    expect(run).toContain("push-by-digest=true");
    expect(run).toContain('ref="$REGISTRY/$name@$(jq -r \'."containerimage.digest"\' "$RUNNER_TEMP/meta.json")"');
    for (const use of [
      '--ignore-unfixed --ignorefile "$ignorefile" --timeout 10m \\\n    "unset-scan/$name:ci"',
      'cosign sign --yes "$ref"',
    ]) {
      expect(run).toContain(use);
    }
    expect(run).toMatch(
      /cosign attest --yes --type slsaprovenance1 --predicate "\$RUNNER_TEMP\/provenance.json" "\$ref"/,
    );
    expect(run).toMatch(/cosign attest --yes --type spdxjson --predicate "\$RUNNER_TEMP\/sbom.json" "\$ref"/);
    expect(run).not.toMatch(/cosign (sign|attest)[^\n]*:\$|--tag|-t "/);
    // P2.24c: the scan reads the ignore file list-dockerfiles.ts gives each image, the one images.yml uses.
    expect(run).toContain("jq -r '.[] | [.name, .dockerfile, .ignorefile] | @tsv'");
    expect(run).toContain("read -r name dockerfile ignorefile");
    // workflows.ts accepts the pull of `$ref` only because this pattern rejects any ref not pinned by digest first.
    expect(run).toContain(`case "$ref" in *@sha256:${"?".repeat(64)}) ;; *) exit 1 ;; esac`);
    // The scanned local image is the pushed digest: pulled by it, checked against its RepoDigests, then tagged.
    expect(run).toContain('docker pull --quiet --platform linux/amd64 "$ref" > /dev/null');
    expect(run).toContain(`docker image inspect --format '{{join .RepoDigests "\\n"}}' "$ref" | grep -qxF "$ref"`);
    expect(run).toContain('docker tag "$ref" "unset-scan/$name:ci"');
    expect(steps.at(-2)?.run).toBe('node scripts/ci/verify-images.ts "$RUNNER_TEMP/images.lock.json"');
    // P2.26m: the last step hands that lock on only after it verified, and no step can run past a failure.
    expect(steps.at(-1)).toEqual({
      name: "Hand the verified lock to the bump job",
      id: "lock",
      run: 'echo "lock=$(jq -c . "$RUNNER_TEMP/images.lock.json")" >> "$GITHUB_OUTPUT"',
    });
    for (const step of steps) expect(step.if, step.name).toBeUndefined();
    expect(JSON.stringify(steps)).not.toContain("continue-on-error");
    // P2.26h: the lock entry names the commit the provenance attests, both from GITHUB_SHA, so verify-images can bind them.
    expect(run).toContain('--arg sha "$GITHUB_SHA"');
    expect(run).toContain("digest: {gitCommit: $sha}");
    expect(run).toContain(
      `jq --arg name "$name" --arg ref "$ref" --arg sha "$GITHUB_SHA" \\\n` +
        `    '.[$name] = {ref: $ref, origin: "first-party", gitCommit: $sha, verify: "cosign-keyless"}'`,
    );
    // cosign is installed from its release by checksum, before anything signs.
    expect(run).toContain('echo "$COSIGN_SHA256  $RUNNER_TEMP/cosign" | sha256sum -c -');
  });

  // P2.26m: the bump job gets the verified lock and the pushed commit, and nothing a pull request controls.
  test("bump_job_runs_one_script_on_the_verified_lock", () => {
    const wf = workflow("publish-images.yml") as Workflow & {
      jobs: Record<string, Job & { needs?: unknown; outputs?: unknown }>;
    };
    expect(Object.keys(wf.jobs)).toEqual(["publish", "bump"]);
    const gh = (expression: string) => `\${{ ${expression} }}`;
    expect(wf.jobs.publish?.outputs).toEqual({ lock: gh("steps.lock.outputs.lock") });
    const bump = wf.jobs.bump;
    expect(bump?.needs).toBe("publish");
    expect(bump?.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(bump?.environment).toBeUndefined();
    const steps = bump?.steps ?? [];
    expect(steps.map((step) => step.uses?.replace(/@.*/, "") ?? "run")).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "run",
    ]);
    expect(steps.at(-1)).toEqual({
      env: {
        GH_TOKEN: gh("secrets.GITHUB_TOKEN"),
        REPO: gh("github.repository"),
        COMMIT: gh("github.sha"),
        RUN_ATTEMPT: gh("github.run_attempt"),
        PUBLISHED_LOCK: gh("needs.publish.outputs.lock"),
      },
      run: "node scripts/ci/lock-bump-pr.ts",
    });
    for (const step of steps) expect(step.if).toBeUndefined();
  });

  // The mirror copy keeps the source's digest: the copy names it, the job reads it back, and the lock holds it.
  test("mirrored_digest_equals_lock", () => {
    const job = workflow("mirror.yml").jobs["copy-and-sign"];
    expect(job?.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    const run = (job?.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(run).toContain('digest="${source##*@}"');
    expect(run).toContain('crane copy "$source" "$mirror@$digest"');
    expect(run).toContain('test "$(crane digest "$mirror@$digest" < /dev/null)" = "$digest"');
    expect(run).toContain('cosign sign --yes "$mirror@$digest"');
    expect(run).toContain('--arg ref "$mirror@$digest"');
    // P2.18s: SeaweedFS is a base we build on, so its upstream keyless signature is checked before the copy: the
    // release workflow at exactly the tag we pin, issued by GitHub Actions (seaweedfs/seaweedfs
    // .github/workflows/container_release_unified.yml at 4.53).
    const verify = [
      "cosign verify --trusted-root deployment/sigstore/trusted_root.json",
      '--certificate-identity "https://github.com/seaweedfs/seaweedfs/.github/workflows/container_release_unified.yml@refs/tags/$tag"',
      "--certificate-oidc-issuer https://token.actions.githubusercontent.com",
      '"$source" < /dev/null > /dev/null',
    ].join(" \\\n        ");
    expect(run).toContain(verify);
    expect(run.indexOf(verify)).toBeLessThan(run.indexOf('crane copy "$source"'));
    // P6.02 (ADR 0092): the distroless Python runtime base is checked the same way, against the identity and issuer
    // GoogleContainerTools/distroless README.md ("How do I verify distroless images?") names.
    const distroless = [
      "cosign verify --trusted-root deployment/sigstore/trusted_root.json",
      "--certificate-identity keyless@distroless.iam.gserviceaccount.com",
      "--certificate-oidc-issuer https://accounts.google.com",
      '"$source" < /dev/null > /dev/null',
    ].join(" \\\n        ");
    expect(run).toContain("gcr.io/distroless/python3-debian13:*@*)");
    expect(run).toContain(distroless);
    expect(run.indexOf(distroless)).toBeLessThan(run.indexOf('crane copy "$source"'));
    expect(job?.steps?.at(-1)?.run).toBe('node scripts/ci/verify-images.ts "$RUNNER_TEMP/mirror.lock.json"');
  });

  // The trusted-root fetch (ADR 0033, Decision 4): by hand only, read-only, no secret or environment, and no way to
  // write to the repository.
  test("sigstore_root_fetch_reads_only", () => {
    const wf = workflow("sigstore-root.yml");
    expect(wf.on).toEqual({ workflow_dispatch: null });
    expect(wf.permissions).toEqual({});
    expect(Object.keys(wf.jobs)).toEqual(["fetch"]);
    const job = wf.jobs.fetch;
    expect(job?.permissions).toEqual({ contents: "read" });
    expect(job?.environment).toBeUndefined();
    const raw = text("sigstore-root.yml");
    expect(raw).not.toMatch(/\bsecrets\b|github\.token|GITHUB_TOKEN/);
    expect(raw).not.toMatch(/git (commit|push)|gh pr|create-pull-request|peter-evans|contents: write/);
    expect((job?.steps ?? []).map((step) => step.uses?.replace(/@.*/, "")).filter(Boolean)).toEqual([
      "actions/upload-artifact",
    ]);
    expect(raw).toContain('echo "$COSIGN_SHA256  $RUNNER_TEMP/cosign" | sha256sum -c -');
  });

  test("image_jobs_never_skip", () => {
    const wf = workflow("images.yml");
    // A required check must start on every ready PR: no path filter may keep it from running.
    expect(JSON.stringify(wf.on)).not.toMatch(/paths/);
    // Both Dockerfiles exist since P1.27 and P1.28, so a missing one is a rename or a deletion: the build step fails
    // on it. No step is gated, so hadolint, Trivy and the build cannot pass by being skipped.
    const dockerfiles = { images: "deployment/images/node-app.Dockerfile", edge: "deployment/edge/Dockerfile" };
    for (const [id, dockerfile] of Object.entries(dockerfiles)) {
      const job = wf.jobs[id];
      expect(job?.env?.DOCKERFILE, id).toBe(dockerfile);
      expect(existsSync(join(ROOT, dockerfile)), dockerfile).toBe(true);
      for (const step of job?.steps ?? []) {
        expect(step.if, `${id} ${step.name}`).toBeUndefined();
        expect(step.run ?? "", `${id} ${step.name}`).not.toContain("skipped");
      }
    }
  });

  /** Every repository file a workflow names outside its comments. */
  const filesRead = (file: string, from = ""): string[] => {
    const whole = text(file);
    const lines = whole
      .slice(whole.indexOf(from))
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"));
    const named = lines.join("\n").match(/(?<![\w./-])(?:\.github|deployment|scripts|docs|tests)\/[\w./-]*\w/g) ?? [];
    return [...new Set(named)].sort();
  };

  // P2.26k: a push that changes only docs/ or tests/ publishes nothing. That is safe only while no image build and
  // no step of the job reads either folder.
  test("publish_skips_only_what_no_image_reads", () => {
    const folders = ["docs", "tests"];
    // P2.26m: the two files a lock bump changes, so a merged bump does not publish again.
    const files = ["deployment/images.lock.json", "deployment/compose.dev.yaml"];
    expect(workflow("publish-images.yml").on).toEqual({
      push: { branches: ["main"], "paths-ignore": [...folders.map((folder) => `${folder}/**`), ...files] },
    });
    // The root build context (`.`, for a <name>.Dockerfile) leaves all of them out.
    const dockerignore = readFileSync(join(ROOT, ".dockerignore"), "utf8").split("\n");
    for (const path of [...folders, ...files]) expect(dockerignore, path).toContain(path);
    expect(dockerignore.filter((line) => line.startsWith("!"))).toEqual([]);
    // Every other context is the Dockerfile's own folder under deployment/, and neither file is inside one.
    const images = listDockerfiles(ROOT);
    expect(images.length).toBeGreaterThan(0);
    for (const { dockerfile } of images) {
      expect(dockerfile).toMatch(/^deployment\//);
      if (!dockerfile.endsWith("/Dockerfile")) continue;
      const context = dockerfile.slice(0, -"Dockerfile".length);
      for (const file of files) expect(file.startsWith(context), `${file} in ${context}`).toBe(false);
    }
    // The jobs themselves read nothing that is ignored (the trigger above them names the ignored files).
    const ignored = (path: string) => /^(?:docs|tests)\//.test(path) || files.includes(path);
    const read = filesRead("publish-images.yml", "\njobs:\n");
    expect(read).toContain("scripts/ci/list-dockerfiles.ts");
    for (const path of read) expect(ignored(path), path).toBe(false);
    for (const { ignorefile } of images) expect(ignored(ignorefile), ignorefile).toBe(false);
  });

  // P2.26k: a push starts the mirror only when it changes a file the workflow reads; the weekly scan stays.
  test("mirror_runs_for_every_file_it_reads", () => {
    const on = workflow("mirror.yml").on as { push: { branches: string[]; paths: string[] }; schedule: unknown[] };
    expect(on.push.branches).toEqual(["main"]);
    expect(on.schedule).toEqual([{ cron: "17 5 * * 1" }]);
    expect(Object.keys(on).sort()).toEqual(["push", "schedule"]);
    const read = filesRead("mirror.yml").filter((path) => path !== ".github/workflows/mirror.yml");
    expect(read).toContain("deployment/mirror.list.json");
    expect(read).toContain("scripts/ci/verify-images.ts");
    for (const path of read) expect(existsSync(join(ROOT, path)), path).toBe(true);
    expect([...on.push.paths].sort()).toEqual([...read, ".github/workflows/mirror.yml"].sort());
    // Exact files only: no pattern that could match less than it seems to, and no exclusion.
    for (const path of on.push.paths) expect(path).toMatch(/^[\w./-]+$/);
  });

  test("image_checks_present", () => {
    const runs = (workflow("images.yml").jobs.images?.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(runs).toContain("/bin/hadolint --config .github/hadolint.yaml");
    expect(runs).toContain(
      "image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .github/trivyignore.app.yaml",
    );
    expect(runs).toContain("-o spdx-json");
    expect(runs).toContain('test "$(docker run --rm --entrypoint id "$APP_IMAGE" -u)" = "65532"');
    expect(runs).toContain("{{.State.Health.Status}}");
  });

  test("web_health_gets_secrets_and_postgres", () => {
    // P2.04i: the web server reads secret files and checks its Postgres connection budget before it listens.
    const job = workflow("images.yml").jobs.images;
    const health = job?.steps?.find((step) => step.name === "Becomes healthy")?.run ?? "";
    const lock = JSON.parse(readFileSync(join(ROOT, "deployment", "images", "bases.lock.json"), "utf8")).postgres;
    expect(job?.env?.POSTGRES_IMAGE).toBe(`${lock.ref}:${lock.tag}@${lock.digest}`);
    // Made in the run, so no key material sits in the repository, and mounted read-only as files, never plain env.
    expect(health).toContain('secrets="$RUNNER_TEMP/secrets"');
    expect(health).toContain('-v "$secrets:/run/secrets:ro"');
    // P2.10: web also needs its pds-admin signing key (an Ed25519 key it checks at boot); build step 5 its chat-admin one.
    const secrets = [
      "pg_password",
      "seal_keyring",
      "oauth_client_keys",
      "pds_admin_web_key",
      "chat_admin_web_key",
      "pds_web_key",
      "objects_web",
    ];
    for (const name of secrets) expect(health).toContain(`"$secrets/${name}"`);
    const files = [
      "PG_PASSWORD_FILE",
      "SEAL_KEYRING_FILE",
      "OAUTH_CLIENT_KEYS_FILE",
      "PDS_ADMIN_WEB_KEY_FILE",
      "CHAT_ADMIN_WEB_KEY_FILE",
      "PDS_WEB_KEY_FILE",
      "OBJECT_STORE_SECRET_FILE",
    ];
    for (const key of files) {
      expect(health).toMatch(new RegExp(`-e ${key}=/run/secrets/\\w+`));
    }
    expect(health).not.toMatch(
      /-e (PG_PASSWORD|SEAL_KEYRING|OAUTH_CLIENT_KEYS|PDS_ADMIN_WEB_KEY|CHAT_ADMIN_WEB_KEY|PDS_WEB_KEY|OBJECT_STORE_SECRET)=/,
    );
    // The rest of web's settings live in its test env file, which must name every one web requires.
    const testEnv = readFileSync(join(ROOT, "deployment", "images", "web.test.env"), "utf8");
    for (const key of [
      "PDS_ADMIN_URL",
      "PDS_ADMIN_WEB_KID",
      "PDS_DID",
      "OBJECT_STORE_URL",
      "OBJECT_STORE_ACCESS_ID",
      "REVIEW_URL",
      "CHAT_ADMIN_URL",
      "CHAT_ADMIN_WEB_KID",
      "CHAT_DOOR_ORIGIN",
      "CHAT_COUNT_URL",
    ])
      expect(testEnv).toMatch(new RegExp(`^${key}=.+$`, "m"));
    // The app and a throwaway Postgres share one job network; the app waits for nothing else.
    expect(health).toMatch(/docker run -d "\$\{pg\[@\]\}" "\$POSTGRES_IMAGE"/);
    expect(health).toMatch(/--network health\b/);
    expect(health).toContain("pg_isready");
  });
});
