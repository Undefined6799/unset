/**
 * Vendor images we run as shipped, each by its exact name, never a host or namespace, and never a base: Bluesky's PDS
 * (Alex, "Allow pinned", 2026-10-07T13:00:19Z; P1.29a), Fossorial's Newt, the dev edge's tunnel to Pangolin (accepted
 * ADR 0030 Decision 2, "pinned by digest and non-root"; P1.37v), and Element's Matrix Authentication Service, the chat
 * server's sign-in (ADR 0098 Decision 1, P6.02; distroless and non-root as shipped). Each is a run-only lock entry,
 * scanned by the mirror workflow at the shipped gate (record 2026-10-07-p129-migrate-image-and-run-only-images, point
 * 2). The image tests and the compose tests both read this one list.
 */
export const VENDOR_IMAGES: ReadonlySet<string> = new Set([
  "ghcr.io/bluesky-social/pds",
  "docker.io/fosrl/newt",
  "ghcr.io/element-hq/matrix-authentication-service",
]);

/**
 * Vendor images a Dockerfile may build on, each by its exact name, as a runtime base only: SeaweedFS, the object store
 * (accepted ADR 0041; P2.18s). Our objects image adds no package, drops the upstream entrypoint and runs `weed` as a
 * non-root user, so only the binary and its Alpine base ship. Never a run-only image (VENDOR_IMAGES), never a builder.
 */
export const VENDOR_BASES: ReadonlySet<string> = new Set([
  "docker.io/chrislusf/seaweedfs",
  // P6.02 (ADR 0098 Decision 1; Alex's card "Yes, use distroless", 2026-11-21): the Synapse image's runtime, Debian's
  // own python3.13 with no pip, shell, apt or dpkg. The image only copies its venv in and runs nothing there.
  "gcr.io/distroless/python3-debian13",
]);
