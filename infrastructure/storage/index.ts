// Storage (P2.18s, ADR 0041): the private object store behind the book's thin contract. The composition root passes
// net-guard's fetch for the `object-store` policy; nothing here opens a connection of its own.
export { createObjectStore, type ObjectStore, type ObjectStoreSettings, type Tags } from "./object-store.ts";
