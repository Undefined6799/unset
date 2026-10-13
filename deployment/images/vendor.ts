/**
 * Vendor images we run as shipped, each by its exact name, never a host or namespace, and never a base: Bluesky's PDS
 * (Alex, "Allow pinned", 2026-10-07T13:00:19Z; P1.29a). Each is a run-only lock entry, scanned by the mirror workflow
 * at the shipped gate (record 2026-10-07-p129-migrate-image-and-run-only-images, point 2). The image tests and the
 * compose tests both read this one list.
 */
export const VENDOR_IMAGES: ReadonlySet<string> = new Set(["ghcr.io/bluesky-social/pds"]);
