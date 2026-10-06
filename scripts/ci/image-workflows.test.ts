// The image workflows' own rules (P1.27q), on top of the repository-wide workflow guard (scripts/guards/workflows.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
const FILES = ["images.yml", "mirror.yml"] as const;
const text = (file: string): string => readFileSync(join(ROOT, ".github", "workflows", file), "utf8");

type Step = { name?: string; id?: string; if?: string; run?: string };
type Job = {
  permissions?: Record<string, string> | string;
  environment?: unknown;
  env?: Record<string, string>;
  steps?: Step[];
};
type Workflow = { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Job> };
const workflow = (file: string): Workflow => parse(text(file));

/**
 * Every cosign call that would talk to the public Rekor log or verify without our key. cosign v3.0.5 uploads to
 * Rekor by default and reads the TUF signing config unless told not to (cmd/cosign/cli/options/sign.go,
 * attest.go), so a sign or attest call must carry both opt-outs; a verify call must name our key.
 */
function cosignProblems(workflowText: string): string[] {
  return workflowText.split("\n").flatMap((line, i) => {
    const call = /\bcosign\s+(sign|attest|verify[\w-]*)\b/.exec(line)?.[1];
    if (call === undefined) return [];
    const missing = call.startsWith("verify")
      ? ["--key"].filter((flag) => !new RegExp(`${flag}[ =]`).test(line))
      : ["--tlog-upload=false", "--use-signing-config=false"].filter((flag) => !line.includes(flag));
    return missing.map((flag) => `line ${i + 1}: cosign ${call} without ${flag}`);
  });
}

describe("image workflows", () => {
  test.each(FILES)("workflow_permissions_minimal %s", (file) => {
    const wf = workflow(file);
    expect(wf.permissions).toEqual({});
    for (const [id, job] of Object.entries(wf.jobs)) {
      expect(job.permissions, `${file} job ${id}`).not.toBe("write-all");
      const signs = (job.steps ?? []).some((step) => /\bcosign\s+(sign|attest)\b/.test(step.run ?? ""));
      // Only a job that signs may use the `signing` environment; until the sign job lands, none may write.
      if (job.environment !== undefined) expect(signs && job.environment === "signing", `${file} job ${id}`).toBe(true);
      if (!signs) expect(job.permissions, `${file} job ${id}`).toEqual({ contents: "read" });
    }
  });

  // Every cosign sign and attest call carries --tlog-upload=false and --use-signing-config=false, so nothing about
  // this private repository reaches the public transparency log; every cosign verify call carries --key.
  test("no_tlog_upload_flag_present", () => {
    for (const file of FILES) expect(cosignProblems(text(file)), file).toEqual([]);
    const ok = 'cosign sign --key env://COSIGN_PRIVATE_KEY --use-signing-config=false --tlog-upload=false "$REF"';
    expect(cosignProblems(ok)).toEqual([]);
    expect(cosignProblems('cosign sign --key env://K "$REF"')).toEqual([
      "line 1: cosign sign without --tlog-upload=false",
      "line 1: cosign sign without --use-signing-config=false",
    ]);
    expect(cosignProblems("cosign attest --tlog-upload=true --use-signing-config=false x")).toEqual([
      "line 1: cosign attest without --tlog-upload=false",
    ]);
    expect(cosignProblems("cosign verify --insecure-ignore-tlog=true x")).toEqual([
      "line 1: cosign verify without --key",
    ]);
    expect(cosignProblems("cosign verify-attestation --key k.pub x")).toEqual([]);
  });

  test("images_skip_only_without_dockerfile", () => {
    const wf = workflow("images.yml");
    // A required check must start on every ready PR: no path filter may keep it from running.
    expect(JSON.stringify(wf.on)).not.toMatch(/paths/);
    const job = wf.jobs.images;
    expect(job?.env?.DOCKERFILE).toBe("deployment/images/node-app.Dockerfile");
    const [checkout, skip, ...rest] = job?.steps ?? [];
    expect(checkout?.run).toBeUndefined();
    expect(skip?.id).toBe("dockerfile");
    expect(skip?.if).toBeUndefined();
    expect(skip?.run).toBe(
      [
        'if [ -e "$DOCKERFILE" ]; then',
        '  echo "present=true" >> "$GITHUB_OUTPUT"',
        "else",
        '  echo "::notice title=images::skipped, no Dockerfile yet (lands in P1.27)"',
        '  echo "present=false" >> "$GITHUB_OUTPUT"',
        "fi",
        "",
      ].join("\n"),
    );
    expect(rest.length).toBeGreaterThan(0);
    for (const step of rest) expect(step.if, step.name).toBe("steps.dockerfile.outputs.present == 'true'");
  });

  test("image_checks_present", () => {
    const runs = (workflow("images.yml").jobs.images?.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(runs).toContain("/bin/hadolint --config .github/hadolint.yaml");
    expect(runs).toMatch(
      /image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --ignorefile \.github\/trivyignore\.yaml/,
    );
    expect(runs).toContain("-o spdx-json");
    expect(runs).toContain('test "$(docker run --rm --entrypoint id "$APP_IMAGE" -u)" = "65532"');
    expect(runs).toContain("{{.State.Health.Status}}");
  });
});
