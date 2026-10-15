// C2 to C5 (P1.30; plan section 2 rule 23, section 6.1 SLSA row): a deploy runs only images from our registry, by
// digest, listed in deployment/images.lock.json, signed with our key, with provenance for our own builds, and every
// lock digest names a multi-arch index. The lock and cosign.pub arrive with P1.27s; until then these checks fail.
//
// Under --env local (P1.27l; architecture record 2026-10-12-p129-local-build-preflight, item 2; Alex, "Yes, local
// only", 2026-10-12T16:44:52Z) a stack built from the checkout has no registry hop for these checks to guard. C2 then
// admits a service only by a build C26 passes, or as a vendor image the dev stack already runs as shipped, by exact
// ref:tag@digest, and the token reader alone may run the node base (record 2026-10-13-p127l-local-gaps, Amendment
// 2, point 2, and Amendment 4); C3 to C5 print UNSIGNED. --env dev and --env prod never take this path
// (c2_to_c5_unchanged_under_dev_and_prod).
import { join } from "node:path";
import { type Service, TOKEN_READER } from "../compose-parse.ts";
import { buildProblem } from "./build.ts";
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
      if (match === null) return fail(`${name} image is not ghcr.io/undefined6799/... by digest`);
      if (!locked.has(`${match[1]}${match[2]}`)) return fail(`${name} image is not in the lock`);
    }
    return pass();
  },
};

/**
 * deployment/images/vendor.ts's VENDOR_IMAGES, which the preflight may not import (dependency-cruiser row
 * deployment-preflight): Bluesky's PDS (Alex, "Allow pinned", 2026-10-07T13:00:19Z). compose.dev.test.ts
 * preflight_vendor_images_match keeps the two equal.
 */
export const VENDOR_IMAGES: ReadonlySet<string> = new Set(["ghcr.io/bluesky-social/pds"]);

type BaseEntry = { ref: string; tag: string; digest: string; stage: string; buildStage: boolean };

/** The node runtime base, which the local token reader runs unbuilt (P1.29h). */
const NODE_BASE = "docker.io/library/node";

/**
 * The images a local stack may run unbuilt, as `ref:tag@digest`. `runOnly` holds the vendor images we run as shipped,
 * each a runtime lock entry no Dockerfile builds on, as compose.dev.yaml may (record
 * 2026-10-07-p129-migrate-image-and-run-only-images, point 2); a builder, or a base our own Dockerfiles harden (caddy,
 * postgres), is never one. `readerOnly` holds the node runtime base, which only the token reader may run (record
 * 2026-10-13-p127l-local-gaps, Amendment 2 point 2(b) and Amendment 4).
 */
function unbuiltImages({ root, readText }: Inputs): { runOnly: Set<string>; readerOnly: Set<string> } | null {
  const bases = readText(join(root, "deployment/images/bases.lock.json"));
  if (bases === null) return null;
  const entries = Object.values(JSON.parse(bases) as Record<string, BaseEntry>);
  const exact = (b: BaseEntry) => `${b.ref}:${b.tag}@${b.digest}`;
  return {
    runOnly: new Set(
      entries.filter((b) => VENDOR_IMAGES.has(b.ref) && b.stage === "runtime" && !b.buildStage).map(exact),
    ),
    readerOnly: new Set(entries.filter((b) => b.ref === NODE_BASE && b.stage === "runtime").map(exact)),
  };
}

/**
 * Why a service may not run the node base: only the token reader may, with no network and only in the tools profile,
 * so `docker compose up` never starts it (the same scope as compose_images_match_lock, P1.29h Amendment 1 item 3).
 */
function readerProblem({ name, networkMode, profiles }: Service): string | null {
  if (name !== TOKEN_READER) return `${name} runs the node base, which only ${TOKEN_READER} may`;
  if (networkMode !== "none") return `${name} runs the node base with a network`;
  if (profiles.length !== 1 || profiles[0] !== "tools") return `${name} runs the node base outside the tools profile`;
  return null;
}

/**
 * C2 under --env local: a service is built from a Dockerfile C26 passes, runs a run-only vendor image exactly, or is the
 * token reader running the node base exactly.
 */
function localImages(inputs: Inputs) {
  const unbuilt = unbuiltImages(inputs);
  if (unbuilt === null) return missing("deployment/images/bases.lock.json");
  for (const service of inputs.compose.services) {
    const problem = localImageProblem(service, unbuilt, inputs);
    if (problem !== null) return fail(problem);
  }
  return pass();
}

/** Why one service's image fails C2 under --env local, or null when it passes. */
function localImageProblem(
  service: Service,
  unbuilt: { runOnly: Set<string>; readerOnly: Set<string> },
  inputs: Inputs,
): string | null {
  const { name, image, build } = service;
  if (build !== null) {
    if (image !== null) return `${name} has both an image and a build`;
    return buildProblem(build, inputs) === null ? null : `${name} builds from a Dockerfile C26 refuses`;
  }
  if (image === null) return `${name} has neither an image nor a build`;
  if (unbuilt.readerOnly.has(image)) return readerProblem(service);
  if (!unbuilt.runOnly.has(image)) return `${name} image is not a run-only vendor image by tag and digest`;
  return null;
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
