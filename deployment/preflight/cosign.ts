// The cosign C3 and C4 run (P2.26b; ADR 0033 Decision 8): one release, by the sha256 of its linux binary for this
// machine, at one path. The deploy runbook installs it there from the release after checking the same sums; bumping
// cosign is a reviewed PR that changes these constants. The sums are sigstore/cosign v3.1.3's cosign_checksums.txt
// (https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign_checksums.txt), for cosign-linux-amd64 and
// cosign-linux-arm64; the amd64 sum is the one the workflows pin.
import type { Run } from "./checks/types.ts";

export const COSIGN = {
  path: "/usr/local/bin/cosign",
  version: "v3.1.3",
  /** By Node's `process.arch`. */
  sha256: {
    x64: "4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71",
    arm64: "c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a",
  } as Readonly<Record<string, string>>,
};

/**
 * Why the cosign at COSIGN.path is not the pinned binary for `arch`, or null when it is. GNU sha256sum prints
 * `<hex>  <file>`; anything else, or a failed run, is a mismatch.
 */
export async function cosignProblem(run: Run, arch: string, signal: AbortSignal): Promise<string | null> {
  const pinned = Object.hasOwn(COSIGN.sha256, arch) ? COSIGN.sha256[arch] : undefined;
  if (pinned === undefined) return `no cosign is pinned for ${arch}`;
  const { code, stdout } = await run("sha256sum", ["--", COSIGN.path], signal);
  const hash = /^([0-9a-f]{64}) {2}/.exec(stdout)?.[1];
  return code === 0 && hash === pinned ? null : `cosign at ${COSIGN.path} is not the pinned ${COSIGN.version} binary`;
}
