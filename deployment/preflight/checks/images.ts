// C2 to C5 (P1.30; plan section 2 rule 23, section 6.1 SLSA row): a deploy runs only images from our registry, by
// digest, listed in deployment/images.lock.json, signed with our key, with provenance for our own builds, and every
// lock digest names a multi-arch index. The lock and cosign.pub arrive with P1.27s; until then these checks fail.
import type { VerifyResult } from "./types.ts";
import { type Check, fail, type Inputs, missing, pass } from "./types.ts";

type LockEntry = { ref?: unknown; origin?: unknown };
const OUR_IMAGE = /^(ghcr\.io\/undefined6799\/[a-z0-9._/-]+)(?::[\w][\w.-]{0,127})?(@sha256:[0-9a-f]{64})$/;
/** Index media types: OCI image index and Docker manifest list (docs: docker buildx imagetools inspect --raw). */
const INDEX_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];

function readLock(inputs: Inputs): Record<string, LockEntry> | null {
  const text = inputs.readText(inputs.lockPath);
  if (text === null) return null;
  const lock = JSON.parse(text) as unknown;
  if (typeof lock !== "object" || lock === null || Array.isArray(lock)) throw new Error("lock is not an object");
  return lock as Record<string, LockEntry>;
}

/** C2: every service image is ours by digest and the lock lists that digest. */
export const c2: Check = {
  id: "C2",
  run: (inputs) => {
    const lock = readLock(inputs);
    if (lock === null) return missing(inputs.lockPath);
    const locked = new Set(Object.values(lock).map((entry) => entry.ref));
    for (const { name, image } of inputs.compose.services) {
      const match = image === null ? null : OUR_IMAGE.exec(image);
      if (match === null) return fail(`${name} image is not ghcr.io/undefined6799/… by digest`);
      if (!locked.has(`${match[1]}${match[2]}`)) return fail(`${name} image is not in the lock`);
    }
    return pass();
  },
};

/** The verifier's answer, asked once for C3 and C4 together. */
const verdicts = new WeakMap<Inputs, Promise<VerifyResult>>();
function verdict(inputs: Inputs, signal: AbortSignal): Promise<VerifyResult> {
  let result = verdicts.get(inputs);
  if (result === undefined) {
    result = inputs.verify(inputs.lockPath, signal);
    verdicts.set(inputs, result);
  }
  return result;
}

/** C3 and C4: the entries of one origin verify; verify-images prefixes each failure with the entry's name. */
function verifies(id: "C3" | "C4", origin: "first-party" | "upstream"): Check {
  return {
    id,
    network: true,
    run: async (inputs, signal) => {
      const lock = readLock(inputs);
      if (lock === null) return missing(inputs.lockPath);
      if (inputs.readText(inputs.cosignKeyPath) === null) return missing(inputs.cosignKeyPath);
      const names = Object.entries(lock).flatMap(([name, entry]) => (entry.origin === origin ? [name] : []));
      const result = await verdict(inputs, signal);
      if (result.ok) return pass(`${names.length} ${origin} images verified`);
      // A failure names its entry; one that names no entry (a spawn error, an empty lock) fails both checks.
      const owner = (line: string) => Object.keys(lock).find((name) => line.startsWith(`${name}:`));
      const [first] = result.failures.filter((line) => {
        const name = owner(line);
        return name === undefined || names.includes(name);
      });
      return first === undefined ? pass(`${names.length} ${origin} images verified`) : fail(first);
    },
  };
}
export const c3 = verifies("C3", "first-party");
export const c4 = verifies("C4", "upstream");

/** C5: every lock digest is a multi-arch index, never one platform's manifest. */
export const c5: Check = {
  id: "C5",
  network: true,
  run: async (inputs, signal) => {
    const lock = readLock(inputs);
    if (lock === null) return missing(inputs.lockPath);
    for (const [name, entry] of Object.entries(lock)) {
      if (typeof entry.ref !== "string") return fail(`${name} has no ref`);
      const kind = await inputs.manifestKind(entry.ref, signal);
      if (!INDEX_TYPES.includes(kind)) return fail(`${name} is not a multi-arch index`);
    }
    return pass();
  },
};
