// C2 to C5 (P1.30; plan section 2 rule 23, section 6.1 SLSA row): a deploy runs only images from our registry, by
// digest, listed in deployment/images.lock.json, signed with our key, with provenance for our own builds, and every
// lock digest names a multi-arch index. The lock and cosign.pub arrive with P1.27s; until then these checks fail.
//
// Under --env local (P1.27l; architecture record 2026-10-12-p129-local-build-preflight, item 2; Alex, "Yes, local
// only", 2026-10-12T16:44:52Z) a stack built from the checkout has no registry hop for these checks to guard: C2
// admits a build, which C26 and C27 judge, or an image named exactly as a base lock entry or a mirror source, and C3
// to C5 print UNSIGNED. --env dev and --env prod never take this path (c2_to_c5_unchanged_under_dev_and_prod).
import { join } from "node:path";
import { readLock } from "./lock.ts";
import type { VerifyResult } from "./types.ts";
import { type Check, fail, type Inputs, missing, pass, unsigned } from "./types.ts";

const OUR_IMAGE = /^(ghcr\.io\/undefined6799\/[a-z0-9._/-]+)(?::[\w][\w.-]{0,127})?(@sha256:[0-9a-f]{64})$/;
/** Index media types: OCI image index and Docker manifest list (docs: docker buildx imagetools inspect --raw). */
const INDEX_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];

/** C2: every service image is ours by digest and the lock lists that digest. */
export const c2: Check = {
  id: "C2",
  run: (inputs) => {
    if (inputs.env === "local") return localImages(inputs);
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

/** Every image a local stack may run unbuilt, as `ref:tag@digest`: the base lock's entries and the mirror's sources. */
function pinnedBases({ root, readText }: Inputs): Set<string> | null {
  const bases = readText(join(root, "deployment/images/bases.lock.json"));
  const mirror = readText(join(root, "deployment/mirror.list.json"));
  if (bases === null || mirror === null) return null;
  const locked = Object.values(JSON.parse(bases) as Record<string, { ref: string; tag: string; digest: string }>);
  const mirrored = JSON.parse(mirror) as { source: string }[];
  return new Set([...locked.map((b) => `${b.ref}:${b.tag}@${b.digest}`), ...mirrored.map((m) => m.source)]);
}

/** C2 under --env local: a service is built from the checkout or runs a pinned, listed base by its exact name. */
function localImages(inputs: Inputs) {
  const pinned = pinnedBases(inputs);
  if (pinned === null) return missing("deployment/images/bases.lock.json or deployment/mirror.list.json");
  for (const { name, image, build } of inputs.compose.services) {
    if (image === null && build === null) return fail(`${name} has neither an image nor a build`);
    if (image !== null && !pinned.has(image))
      return fail(`${name} image is not a locked base or mirror source by digest`);
  }
  return pass();
}

/** C3 to C5 on a local stack: built from the checkout, so nothing was signed and nothing is asked of a registry. */
const LOCAL_UNSIGNED = "local build, not signed";

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
      if (inputs.env === "local") return unsigned(LOCAL_UNSIGNED);
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
    if (inputs.env === "local") return unsigned(LOCAL_UNSIGNED);
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
