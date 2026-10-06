// Where each client module is served from: Vite's dev paths, or the production build's manifest read once at boot.
import { readFileSync } from "node:fs";

type Chunk = { file: string; css?: string[]; imports?: string[] };

const prod = import.meta.env.PROD;
const manifest: Record<string, Chunk> = prod
  ? JSON.parse(readFileSync(new URL("../client/.vite/manifest.json", import.meta.url), "utf8"))
  : {};

/** The URL a source module (repo-relative to the spike, e.g. "src/islands/Counter.tsx") is served at. */
export function assetUrl(source: string): string {
  if (!prod) return `/${source}`;
  const chunk = manifest[source];
  if (chunk === undefined) throw new Error(`not in the client manifest: ${source}`);
  return `/${chunk.file}`;
}

/** The CSS files the production build emitted for a source module and every chunk it imports. */
export function cssUrls(source: string, seen = new Set<string>()): string[] {
  if (seen.has(source)) return [];
  seen.add(source);
  const chunk = manifest[source];
  const own = (chunk?.css ?? []).map((file) => `/${file}`);
  return [...own, ...(chunk?.imports ?? []).flatMap((key) => cssUrls(key, seen))];
}
