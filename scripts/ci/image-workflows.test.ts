// The image workflows' own rules (P1.27q; keyless signing since P1.27s, ADR 0033), on top of the repository-wide
// workflow guard (scripts/guards/workflows.ts).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
const FILES = ["images.yml", "mirror.yml", "publish-images.yml", "sigstore-root.yml"] as const;
/** The jobs that sign, and the permissions each holds: exactly these. */
const SIGNING: Record<string, Record<string, Record<string, string>>> = {
  "publish-images.yml": { publish: { contents: "read", packages: "write", "id-token": "write" } },
  "mirror.yml": { "copy-and-sign": { contents: "read", packages: "write", "id-token": "write" } },
};
const text = (file: string): string => readFileSync(join(ROOT, ".github", "workflows", file), "utf8");

type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string };
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
      if (!signs) expect(job.permissions, `${file} job ${id}`).toEqual(reads);
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
    expect(steps.at(-1)?.run).toBe('node scripts/ci/verify-images.ts "$RUNNER_TEMP/images.lock.json"');
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
    for (const name of ["pg_password", "seal_keyring", "oauth_client_keys"])
      expect(health).toContain(`"$secrets/${name}"`);
    for (const key of ["PG_PASSWORD_FILE", "SEAL_KEYRING_FILE", "OAUTH_CLIENT_KEYS_FILE"]) {
      expect(health).toMatch(new RegExp(`-e ${key}=/run/secrets/\\w+`));
    }
    expect(health).not.toMatch(/-e (PG_PASSWORD|SEAL_KEYRING|OAUTH_CLIENT_KEYS)=/);
    // The app and a throwaway Postgres share one job network; the app waits for nothing else.
    expect(health).toMatch(/docker run -d "\$\{pg\[@\]\}" "\$POSTGRES_IMAGE"/);
    expect(health).toMatch(/--network health\b/);
    expect(health).toContain("pg_isready");
  });
});
