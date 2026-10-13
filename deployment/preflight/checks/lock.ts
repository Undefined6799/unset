// The deploy lock, deployment/images.lock.json (P1.30): which image each service runs, as C2 to C5, C18, C25 and C27
// read it.
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
