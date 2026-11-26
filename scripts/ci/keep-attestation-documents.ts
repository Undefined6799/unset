// Prunes the npm cache the `audit` job carries between runs down to attestation documents (P0.07p; threat "a kept
// cache lets the signature audit pass on stale registry data").
//
// Why a store at all. Since 2026-11-23 registry.npmjs.org's CDN holds, for single packages and at single locations,
// a stored answer `200 text/plain "OK"` where the attestation document belongs, with a one-year lifetime. Nothing a
// client sends gets past it, npm 11.20.0 does not retry it, and `npm audit signatures` stops having verified nothing
// (docs/ai/notes/pitfall/npm-registry-answers-attestations-with-ok.md). The registry serves the real document with
// `cache-control: public, max-age=31557600`, so npm's own cache replays a stored copy without asking again. The job
// keeps the copies of a run that verified everything, and later runs verify those copies.
//
// Why pruned. npm's cache also stores packuments, and make-fetch-happen 15.0.6 (lib/cache/entry.js:403-407) answers
// from a stale packument when the registry cannot be reached. Kept packuments would let the audit pass on old
// signatures while the registry is down. So nothing but attestation documents may be in the store, before the audit
// reads it and before the job saves it. Packuments, the signing keys and Sigstore's trust root are asked for on
// every run, as before.
//
// How. `npm cache clean <key>` is no use here: it leaves the index entry, which npm then follows to a missing file
// (measured, npm 11.20.0). This script removes index files itself. cacache 20.0.4 (lib/entry-index.js) keeps one
// file per key under `_cacache/index-v5/`, each line `<hash>\t<json entry with "key">`, and content by digest under
// `_cacache/content-v2/`. An index file stays only if every line parses and every key is an attestation address;
// anything else, an unknown folder included, is deleted, so a layout this script does not know keeps nothing. Then
// `npm cache verify` deletes the content no index entry points to.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/** npm's cache key for an attestation document of the public registry (make-fetch-happen lib/cache/key.js). */
export const ATTESTATION_KEYS = "make-fetch-happen:request-cache:https://registry.npmjs.org/-/npm/v1/attestations/";
const INDEX = "index-v5";
const STORE_FOLDERS: readonly string[] = [INDEX, "content-v2"];

/** The keys an index file holds, or null when a line is not `<hash>\t<json entry with a string key>`. */
function keysIn(text: string): string[] | null {
  const keys: string[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    try {
      const entry: unknown = JSON.parse(line.slice(line.indexOf("\t") + 1));
      const key = typeof entry === "object" && entry !== null && "key" in entry ? entry.key : undefined;
      if (typeof key !== "string") return null;
      keys.push(key);
    } catch {
      return null;
    }
  }
  return keys;
}

/** Deletes everything under `folder` that is not an index file of kept keys only; returns [kept, dropped]. */
function pruneIndex(folder: string, keyPrefix: string): [number, number] {
  let kept = 0;
  let dropped = 0;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      const [k, d] = pruneIndex(path, keyPrefix);
      kept += k;
      dropped += d;
      continue;
    }
    const keys = entry.isFile() ? keysIn(readFileSync(path, "utf8")) : null;
    if (keys !== null && keys.length > 0 && keys.every((key) => key.startsWith(keyPrefix))) {
      kept++;
      continue;
    }
    rmSync(path, { force: true });
    dropped++;
  }
  return [kept, dropped];
}

/**
 * Leaves in npm cache folder `cache` only the entries whose key starts with `keyPrefix`, and fails if anything
 * else is still there afterwards. A cache that does not exist yet is left alone.
 */
export function keepOnly(cache: string, keyPrefix: string): { kept: number; dropped: number } {
  const store = join(cache, "_cacache");
  if (!existsSync(join(store, INDEX))) return { kept: 0, dropped: 0 };
  for (const name of readdirSync(store))
    if (!STORE_FOLDERS.includes(name)) rmSync(join(store, name), { recursive: true, force: true });
  const [, dropped] = pruneIndex(join(store, INDEX), keyPrefix);
  const verify = spawnSync("npm", ["cache", "verify", `--cache=${cache}`], { encoding: "utf8" });
  if (verify.status !== 0) throw new Error(`npm cache verify failed: ${verify.error?.message ?? verify.stderr}`);
  const [kept, left] = pruneIndex(join(store, INDEX), keyPrefix);
  if (left !== 0) throw new Error(`${left} entries that are not attestation documents were still in ${store}`);
  return { kept, dropped };
}

if (import.meta.main) {
  const [cache] = process.argv.slice(2);
  if (cache === undefined) throw new Error("usage: keep-attestation-documents.ts <npm cache folder>");
  const { kept, dropped } = keepOnly(cache, ATTESTATION_KEYS);
  console.log(`attestation store: ${kept} documents kept, ${dropped} other entries removed`);
}
