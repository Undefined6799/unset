// P2.26e: the Sigstore trusted root the preflight verifies our keyless signatures against, offline (P2.26b). It comes
// from a manual run of sigstore-root.yml, which fetches it through Sigstore's TUF client from the public-good root
// (sigstore/root-signing, targets/trusted_root.json). Format: the TrustedRoot message of sigstore/protobuf-specs
// (protos/sigstore_trustroot.proto: tlogs, certificate_authorities, ctlogs, timestamp_authorities), serialised as
// proto3 JSON with camelCase names. A refresh is a new run plus a trusted-base PR that changes the file and its sha256.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const bytes = readFileSync(join(import.meta.dirname, "trusted_root.json"));

type Validity = { start?: string; end?: string };
type Tlog = { baseUrl?: string; publicKey?: { rawBytes?: string; validFor?: Validity }; logId?: { keyId?: string } };
type Authority = { uri?: string; certChain?: { certificates?: { rawBytes?: string }[] }; validFor?: Validity };
type TrustedRoot = { mediaType?: string; tlogs?: Tlog[]; certificateAuthorities?: Authority[] };

/** An entry still in force: it has started and names no end, so new signatures chain to it. */
const current = (validFor: Validity | undefined): boolean =>
  validFor?.start !== undefined && validFor.end === undefined;

describe("sigstore trusted root", () => {
  test("trusted_root_is_the_reviewed_file", () => {
    // sigstore/root-signing targets.json version 14 (root version 16) lists this sha256 and length 6787 for
    // trusted_root.json; changing the file means changing this line in a reviewed trusted-base PR.
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66",
    );
  });

  test("trusted_root_names_fulcio_and_rekor", () => {
    const root = JSON.parse(bytes.toString("utf8")) as TrustedRoot;
    expect(root.mediaType).toBe("application/vnd.dev.sigstore.trustedroot+json;version=0.1");
    const rekor = (root.tlogs ?? []).filter((log) => log.baseUrl === "https://rekor.sigstore.dev");
    expect(rekor.length).toBeGreaterThan(0);
    for (const log of rekor) {
      expect(log.publicKey?.rawBytes).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(log.logId?.keyId).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    }
    const fulcio = (root.certificateAuthorities ?? []).filter((ca) => ca.uri === "https://fulcio.sigstore.dev");
    expect(fulcio.some((ca) => current(ca.validFor))).toBe(true);
    for (const ca of fulcio) {
      expect(ca.certChain?.certificates?.length ?? 0).toBeGreaterThan(0);
      for (const cert of ca.certChain?.certificates ?? []) expect(cert.rawBytes).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
  });
});
