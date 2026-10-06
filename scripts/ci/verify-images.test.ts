import { describe, expect, test } from "vitest";
import { type CosignRun, type ImageLock, verifyImages } from "./verify-images.ts";

const KEY = "deployment/cosign.pub";
const DIGEST = `sha256:${"a".repeat(64)}`;
const LOCK: ImageLock = {
  web: { ref: `ghcr.io/undefined6799/unset/web@${DIGEST}`, origin: "first-party", verify: "cosign-key" },
  postgres: {
    ref: `ghcr.io/undefined6799/mirror/postgres@${DIGEST}`,
    origin: "upstream",
    upstreamSource: `docker.io/library/postgres@${DIGEST}`,
    verify: "cosign-key",
  },
};
const EXPECTED = { repository: "https://github.com/Undefined6799/unset", workflow: ".github/workflows/images.yml" };

/** An in-toto statement as cosign verify-attestation prints it: one DSSE envelope per line. */
function provenance(workflow: { repository: string; ref: string; path: string }): string {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: { buildDefinition: { externalParameters: { workflow } } },
  };
  return JSON.stringify({ payload: Buffer.from(JSON.stringify(statement)).toString("base64") });
}

const good = provenance({ repository: EXPECTED.repository, ref: "refs/heads/main", path: EXPECTED.workflow });

/** A registry where every ref was signed with `signedWith` and carries `attestation`. */
function cosign(signedWith: string | null, attestation = good): { run: CosignRun; calls: string[][] } {
  const calls: string[][] = [];
  const run: CosignRun = async (args) => {
    calls.push(args);
    const key = args[args.indexOf("--key") + 1];
    if (signedWith === null || key !== signedWith) return { code: 1, stdout: "", stderr: "no matching signatures" };
    return { code: 0, stdout: args[0] === "verify-attestation" ? `${attestation}\n` : "[]", stderr: "" };
  };
  return { run, calls };
}

describe("verify-images", () => {
  test("verify_images_accepts_signed", async () => {
    const { run, calls } = cosign(KEY);
    expect(await verifyImages(LOCK, { key: KEY, ...EXPECTED, run })).toEqual({ ok: true });
    for (const args of calls) {
      expect(args).toContain("--insecure-ignore-tlog=true");
      expect(args).toContain("--new-bundle-format=false");
    }
    // The upstream mirror carries our signature only; provenance is checked for first-party images.
    expect(calls.filter((a) => a[0] === "verify-attestation").map((a) => a.at(-1))).toEqual([LOCK.web?.ref]);
  });

  test("verify_images_rejects_unsigned", async () => {
    const result = await verifyImages(LOCK, { key: KEY, ...EXPECTED, run: cosign(null).run });
    expect(result).toEqual({
      ok: false,
      failures: [
        "web: signature does not verify: no matching signatures",
        "postgres: signature does not verify: no matching signatures",
      ],
    });
  });

  test("verify_images_rejects_wrong_key", async () => {
    const result = await verifyImages(LOCK, { key: KEY, ...EXPECTED, run: cosign("other.pub").run });
    expect(result.ok).toBe(false);
  });

  test("verify_images_rejects_provenance_from_other_workflow", async () => {
    const other = provenance({
      repository: EXPECTED.repository,
      ref: "refs/heads/main",
      path: ".github/workflows/x.yml",
    });
    const result = await verifyImages(LOCK, { key: KEY, ...EXPECTED, run: cosign(KEY, other).run });
    expect(result).toEqual({ ok: false, failures: ["web: provenance names workflow .github/workflows/x.yml"] });
  });

  test("verify_images_rejects_provenance_from_other_branch", async () => {
    const branch = provenance({ repository: EXPECTED.repository, ref: "refs/heads/dev", path: EXPECTED.workflow });
    const result = await verifyImages(LOCK, { key: KEY, ...EXPECTED, run: cosign(KEY, branch).run });
    expect(result).toEqual({ ok: false, failures: ["web: provenance names ref refs/heads/dev"] });
  });

  test("verify_images_rejects_provenance_from_other_repo", async () => {
    const repo = provenance({ repository: "https://github.com/x/y", ref: "refs/heads/main", path: EXPECTED.workflow });
    const result = await verifyImages(LOCK, { key: KEY, ...EXPECTED, run: cosign(KEY, repo).run });
    expect(result).toEqual({ ok: false, failures: ["web: provenance names repository https://github.com/x/y"] });
  });

  test("verify_images_rejects_empty_lock", async () => {
    expect(await verifyImages({}, { key: KEY, ...EXPECTED, run: cosign(KEY).run })).toEqual({
      ok: false,
      failures: ["the lock names no images"],
    });
  });

  test("verify_images_rejects_ref_outside_registry", async () => {
    const lock: ImageLock = { web: { ref: "docker.io/library/node:26", origin: "first-party", verify: "cosign-key" } };
    const result = await verifyImages(lock, { key: KEY, ...EXPECTED, run: cosign(KEY).run });
    expect(result).toEqual({ ok: false, failures: ["web: ref is not ghcr.io/undefined6799/… by digest"] });
  });
});
