// The deploy lock, deployment/images.lock.json (P1.30): which image each service runs, as C2 to C5, C18, C25 and C27
// read it. And the base lock, deployment/images/bases.lock.json, which names the upstream images a local stack may run
// unbuilt (C2 under --env local).
import { join } from "node:path";
import type { Inputs } from "./types.ts";

type LockEntry = { ref?: unknown; origin?: unknown };

/** The deploy lock C2 to C5 and C18 read, or null when the file is missing. */
export function readLock(inputs: Inputs): Record<string, LockEntry> | null {
  const text = inputs.readText(inputs.lockPath);
  if (text === null) return null;
  const lock = JSON.parse(text) as unknown;
  if (typeof lock !== "object" || lock === null || Array.isArray(lock)) throw new Error("lock is not an object");
  return lock as Record<string, LockEntry>;
}

/**
 * The lock for a check that also accepts a service by its build (C25, C27). A local stack has none (P1.27l), so there
 * only the build can pass: an empty lock names no ref for an image to match.
 */
export const lockOrNone = (inputs: Inputs): Record<string, LockEntry> | null =>
  inputs.env === "local" ? {} : readLock(inputs);

/** One entry of the base lock: an upstream image by exact tag and digest. */
export type BaseEntry = { ref: string; tag: string; digest: string; stage: string; buildStage: boolean };

/** The base lock's entries by name, or null when the file is missing. */
export function readBases({ root, readText }: Pick<Inputs, "root" | "readText">): Record<string, BaseEntry> | null {
  const text = readText(join(root, "deployment/images/bases.lock.json"));
  return text === null ? null : (JSON.parse(text) as Record<string, BaseEntry>);
}

/** An entry as a service names it: `ref:tag@digest`. */
export const exactImage = (entry: BaseEntry): string => `${entry.ref}:${entry.tag}@${entry.digest}`;
