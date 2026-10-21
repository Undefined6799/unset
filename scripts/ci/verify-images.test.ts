// verify-images (P1.27q; keyless since P1.27s, ADR 0033), with cosign through the injected runner: a fake registry that
// knows which certificate signed each ref and whether its bundle carries a Rekor entry, and answers as cosign does.
import { describe, expect, test } from "vitest";
import { type CosignRun, type ImageLock, type LockEntry, verifyImages } from "./verify-images.ts";

const REPO = "Undefined6799/unset";
const ISSUER = "https://token.actions.githubusercontent.com";
const PUBLISH = `https://github.com/${REPO}/.github/workflows/publish-images.yml@refs/heads/main`;
const MIRROR = `https://github.com/${REPO}/.github/workflows/mirror.yml@refs/heads/main`;
const DIGEST = `sha256:${"a".repeat(64)}`;
const WEB = `ghcr.io/undefined6799/unset/web@${DIGEST}`;
const POSTGRES = `ghcr.io/undefined6799/mirror/postgres@${DIGEST}`;
const LOCK: ImageLock = {
  web: { ref: WEB, origin: "first-party", verify: "cosign-keyless" },
  postgres: {
    ref: POSTGRES,
    origin: "upstream",
    upstreamSource: `docker.io/library/postgres@${DIGEST}`,
    verify: "cosign-keyless",
  },
};

/** An in-toto statement as cosign verify-attestation prints it: one DSSE envelope per line. */
function provenance(workflow: { repository: string; ref: string; path: string }): string {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: { buildDefinition: { externalParameters: { workflow } } },
  };
  return JSON.stringify({ payload: Buffer.from(JSON.stringify(statement)).toString("base64") });
}
const workflow = {
  repository: `https://github.com/${REPO}`,
  ref: "refs/heads/main",
  path: ".github/workflows/publish-images.yml",
};
const good = provenance(workflow);

/** What signed one ref: the certificate's identity, issuer and extensions, and whether a bundle and tlog entry exist. */
type Signed = { identity: string; issuer?: string; repo?: string; ref?: string; bundle?: boolean; tlog?: boolean };
const SIGNED: Record<string, Signed> = { [WEB]: { identity: PUBLISH }, [POSTGRES]: { identity: MIRROR } };

/** cosign over a registry where each ref was signed as `signed` says; a flag's value is the word after it. */
function cosign(signed: Record<string, Signed> = SIGNED, attestation = good): { run: CosignRun; calls: string[][] } {
  const calls: string[][] = [];
  const run: CosignRun = async (args) => {
    calls.push(args);
    const flag = (name: string) => args[args.indexOf(name) + 1];
    const cert = signed[args.at(-1) ?? ""];
    const fail = (stderr: string) => ({ code: 1, stdout: "", stderr });
    if (cert === undefined) return fail("no signatures found");
    if (cert.bundle === false) return fail("no bundle found");
    if (cert.tlog === false && !args.includes("--insecure-ignore-tlog=true")) return fail("no transparency log entry");
    if (flag("--certificate-identity") !== cert.identity) return fail("none of the expected identities matched");
    if (flag("--certificate-oidc-issuer") !== (cert.issuer ?? ISSUER)) return fail("expected issuer not found");
    if (flag("--certificate-github-workflow-repository") !== (cert.repo ?? REPO)) return fail("repository mismatch");
    if (flag("--certificate-github-workflow-ref") !== (cert.ref ?? "refs/heads/main")) return fail("ref mismatch");
    return { code: 0, stdout: args[0] === "verify-attestation" ? `${attestation}\n` : "[]", stderr: "" };
  };
  return { run, calls };
}
const verify = (lock: ImageLock, run: CosignRun, repository = REPO) => verifyImages(lock, { repository, run });

describe("verify-images", () => {
  test("verify_images_accepts_signed", async () => {
    const { run, calls } = cosign();
    expect(await verify(LOCK, run)).toEqual({ ok: true });
    for (const args of calls) {
      expect(args.join(" ")).not.toMatch(/regexp|insecure-ignore-tlog|--key\b|private-infrastructure|--offline/);
    }
    // Each kind is checked against its own workflow; provenance only for first-party images.
    expect(calls.map((a) => [a[0], a[a.indexOf("--certificate-identity") + 1], a.at(-1)])).toEqual([
      ["verify", PUBLISH, WEB],
      ["verify-attestation", PUBLISH, WEB],
      ["verify", MIRROR, POSTGRES],
    ]);
  });

  test("trusted_root_makes_it_offline", async () => {
    const { run, calls } = cosign();
    expect(
      await verifyImages(LOCK, { repository: REPO, trustedRoot: "deployment/sigstore/trusted_root.json", run }),
    ).toEqual({ ok: true });
    for (const args of calls)
      expect(args[args.indexOf("--trusted-root") + 1]).toBe("deployment/sigstore/trusted_root.json");
  });

  test("verify_images_rejects_wrong_identity", async () => {
    // A first-party image signed by the mirror workflow, and a mirror signed by publish-images, both fail.
    const swapped = { [WEB]: { identity: MIRROR }, [POSTGRES]: { identity: PUBLISH } };
    expect(await verify(LOCK, cosign(swapped).run)).toEqual({
      ok: false,
      failures: [
        "web: signature does not verify: none of the expected identities matched",
        "postgres: signature does not verify: none of the expected identities matched",
      ],
    });
    // The certificate's own repository and ref extensions are checked too.
    const fork = { ...SIGNED, [WEB]: { identity: PUBLISH, repo: "someone/unset" } };
    expect((await verify(LOCK, cosign(fork).run)).ok).toBe(false);
    const branch = { ...SIGNED, [WEB]: { identity: PUBLISH, ref: "refs/heads/dev" } };
    expect((await verify(LOCK, cosign(branch).run)).ok).toBe(false);
  });

  test("verify_images_rejects_wrong_issuer", async () => {
    const google = { ...SIGNED, [WEB]: { identity: PUBLISH, issuer: "https://accounts.google.com" } };
    expect(await verify(LOCK, cosign(google).run)).toEqual({
      ok: false,
      failures: ["web: signature does not verify: expected issuer not found"],
    });
  });

  test("verify_images_rejects_regexp_identity", async () => {
    // The identity is built from the repository, so a pattern there would widen it: refused before cosign runs.
    for (const repository of [".*", "Undefined6799/.*", "Undefined6799/unset|other/x", ""]) {
      const { run, calls } = cosign();
      expect(await verify(LOCK, run, repository)).toEqual({
        ok: false,
        failures: ["the repository is not owner/name"],
      });
      expect(calls).toEqual([]);
    }
    // And a lock entry may not name its own identity.
    const named = { web: { ...LOCK.web, identity: "https://github.com/.*" } as LockEntry };
    expect(await verify(named, cosign().run)).toEqual({
      ok: false,
      failures: ["web: the entry names identity; the signer is fixed by its origin"],
    });
  });

  test("verify_images_rejects_missing_bundle", async () => {
    const bare = { ...SIGNED, [POSTGRES]: { identity: MIRROR, bundle: false } };
    expect(await verify(LOCK, cosign(bare).run)).toEqual({
      ok: false,
      failures: ["postgres: signature does not verify: no bundle found"],
    });
  });

  test("verify_images_rejects_missing_tlog_entry", async () => {
    const untlogged = { ...SIGNED, [WEB]: { identity: PUBLISH, tlog: false } };
    expect(await verify(LOCK, cosign(untlogged).run)).toEqual({
      ok: false,
      failures: ["web: signature does not verify: no transparency log entry"],
    });
  });

  test("verify_images_rejects_unsigned", async () => {
    expect(await verify(LOCK, cosign({}).run)).toEqual({
      ok: false,
      failures: [
        "web: signature does not verify: no signatures found",
        "postgres: signature does not verify: no signatures found",
      ],
    });
  });

  test("verify_images_rejects_other_provenance", async () => {
    for (const [field, value, failure] of [
      ["path", ".github/workflows/x.yml", "web: provenance names workflow .github/workflows/x.yml"],
      ["ref", "refs/heads/dev", "web: provenance names ref refs/heads/dev"],
      ["repository", "https://github.com/x/y", "web: provenance names repository https://github.com/x/y"],
    ] as const) {
      const other = provenance({ ...workflow, [field]: value });
      expect(await verify(LOCK, cosign(SIGNED, other).run), field).toEqual({ ok: false, failures: [failure] });
    }
  });

  test("verify_images_rejects_empty_lock_and_other_refs", async () => {
    expect(await verify({}, cosign().run)).toEqual({ ok: false, failures: ["the lock names no images"] });
    const outside: ImageLock = {
      web: { ref: "docker.io/library/node:26", origin: "first-party", verify: "cosign-keyless" },
    };
    const keyed = { web: { ...LOCK.web, verify: "cosign-key" } as unknown as LockEntry };
    for (const lock of [outside, keyed]) {
      expect(await verify(lock, cosign().run)).toEqual({
        ok: false,
        failures: ["web: ref is not ghcr.io/undefined6799/… by digest, signed keyless"],
      });
    }
  });
});
