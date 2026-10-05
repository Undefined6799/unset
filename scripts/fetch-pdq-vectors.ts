// Fetches the ThreatExchange PDQ reference images the PDQ tests hash (P2.16b) at one pinned commit and checks each
// file's SHA-256, so the tests always compare against the same bytes. The images are never committed: ThreatExchange
// provides them for open-source testing only (pdq/wasm/README.md:7). Prints a JSON object of repository path → cached file on success; any
// mismatch or failure exits 1.
// Source: https://github.com/facebook/ThreatExchange/tree/85978d7cabdf631c0e4be9cb2be2816b2b9a6911/pdq/data

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const THREATEXCHANGE_COMMIT = "85978d7cabdf631c0e4be9cb2be2816b2b9a6911";
/** Repository paths and their SHA-256 at THREATEXCHANGE_COMMIT. */
export const PDQ_VECTORS: readonly { path: string; sha256: string }[] = [
  {
    path: "pdq/data/reg-test-input/pen-and-coaster.png",
    sha256: "9bb522d00383f83f462058e06a09cc01fde43c0cff0238031aaff8ca1cfdb36d",
  },
  { path: "pdq/data/misc-images/c.png", sha256: "93aa0ba454d3805e02be04a883b839a85bee83d0cbac3d306331584c1ebec0c6" },
];
export const DEFAULT_CACHE = join(import.meta.dirname, "..", "node_modules", ".cache", "pdq-vectors");
const TIMEOUT_MS = 30_000;

export type Download = (url: string) => Promise<Uint8Array>;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const urlOf = (path: string): string =>
  `https://raw.githubusercontent.com/facebook/ThreatExchange/${THREATEXCHANGE_COMMIT}/${path}`;

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Each pinned file in `cache`, named by its SHA-256: a cached copy is used only if its bytes still match, otherwise
 * it is downloaded again. A downloaded file whose SHA-256 differs from the pin throws and is not written.
 */
export async function fetchPdqVectors(cache = DEFAULT_CACHE, get: Download = download): Promise<Map<string, string>> {
  mkdirSync(cache, { recursive: true });
  const files = new Map<string, string>();
  for (const { path, sha256: pinned } of PDQ_VECTORS) {
    const file = join(cache, pinned);
    if (!existsSync(file) || sha256(readFileSync(file)) !== pinned) {
      const bytes = await get(urlOf(path));
      const actual = sha256(bytes);
      if (actual !== pinned) throw new Error(`${path}: SHA-256 ${actual} is not the pinned ${pinned}`);
      // Rename is atomic, so a test reading the cache in parallel never sees half a file.
      writeFileSync(`${file}.${process.pid}.tmp`, bytes);
      renameSync(`${file}.${process.pid}.tmp`, file);
    }
    files.set(path, file);
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    console.log(JSON.stringify(Object.fromEntries(await fetchPdqVectors())));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
