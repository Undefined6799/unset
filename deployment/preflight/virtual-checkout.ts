// Test support for the tests that run the whole preflight on a real compose file (compose.local.test.ts,
// real-dev.test.ts): this checkout read as the deploy user's, its parents as root's folders, and its sibling folders
// virtual, held in `files`. Anything else reads as missing.
import { lstatSync, type Stats } from "node:fs";

/** A virtual folder (with its entry names) or file (with its text) beside the checkout. */
export type VirtualEntry = { kind: "dir" | "file"; mode: number; uid: number; text?: string; names?: string[] };

export interface VirtualCheckoutOptions {
  /** The real checkout's absolute path. */
  readonly checkout: string;
  readonly files: ReadonlyMap<string, VirtualEntry>;
  /** The owner every real path in the checkout reads as. */
  readonly deployUid: number;
  /** The device every virtual entry reads as on. */
  readonly dev: number;
}

export interface VirtualCheckout {
  /** True for `/` and every folder the checkout sits in. */
  aboveCheckout(path: string): boolean;
  /** An lstat or stat for the preflight's deps: a virtual entry, a parent folder, a real path in the checkout, or null. */
  look(read: (path: string) => Stats): (path: string) => Stats | null;
  /** `read()` for a real path in the checkout, or null outside it or when the read throws. */
  real<T>(path: string, read: () => T): T | null;
}

export function virtualCheckout({ checkout, files, deployUid, dev }: VirtualCheckoutOptions): VirtualCheckout {
  const inCheckout = (path: string) => path === checkout || path.startsWith(`${checkout}/`);
  const aboveCheckout = (path: string) => path === "/" || checkout.startsWith(`${path}/`);
  /** A stat of a virtual entry; a copy of a real one, so the methods are Node's. */
  const made = (kind: "dir" | "file", mode: number, uid: number, ino: number): Stats =>
    Object.assign(lstatSync(checkout), {
      mode: (kind === "dir" ? 0o040000 : 0o100000) | mode,
      uid,
      size: kind === "dir" ? 4096 : 24,
      nlink: kind === "dir" ? 2 : 1,
      dev,
      ino,
    });
  const look = (read: (path: string) => Stats) => (path: string) => {
    const entry = files.get(path);
    if (entry !== undefined) return made(entry.kind, entry.mode, entry.uid, 1 + [...files.keys()].indexOf(path));
    if (aboveCheckout(path)) return made("dir", 0o755, 0, 100 + path.length);
    if (!inCheckout(path)) return null;
    try {
      const info = read(path);
      // The checkout as the deploy user's, with no group or other write.
      return Object.assign(info, { uid: deployUid, mode: info.mode & ~0o022 });
    } catch {
      return null;
    }
  };
  const real = <T>(path: string, read: () => T): T | null => {
    if (!inCheckout(path)) return null;
    try {
      return read();
    } catch {
      return null;
    }
  };
  return { aboveCheckout, look, real };
}
