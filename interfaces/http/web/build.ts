// apps/web's browser build, read once at startup (P1.23; architecture ruling 2026-10-06,
// 2026-10-06-p123-islands-runtime-placement.md). Vite's manifest (vite 8.3.1: `build.manifest` writes
// `.vite/manifest.json`; entries are `ManifestChunk`, dist/node/index.d.ts) gives both the render prop and the one
// list of files the assets route may serve. A missing or malformed manifest fails startup: no page silently loses its
// islands.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BuildManifest, islandName } from "@unset/apps-web";

/** The parsed build: what render.tsx needs, and every servable file by its name under /assets/. */
export type WebBuild = Readonly<{ manifest: BuildManifest; files: ReadonlyMap<string, string> }>;

type Chunk = { file: string; src?: string; isEntry?: boolean; imports?: string[]; css?: string[]; assets?: string[] };

const MANIFEST = ".vite/manifest.json";
const BOOT_SOURCE = "src/islands/runtime/bootstrap.ts";
/** A built file name: `assets/` and one segment, so no `..`, no leading `/` and no nested path. */
const FILE = /^assets\/[A-Za-z0-9._-]+$/;
const ISLAND = /\.island\.tsx$/;

const fail = (why: string): never => {
  throw new Error(`web build manifest: ${why}`);
};

const isList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** One manifest entry, checked field by field; anything off its shape fails. */
function chunkOf(key: string, value: unknown): Chunk {
  if (typeof value !== "object" || value === null) return fail(`${key} is not an object`);
  const chunk = value as Record<string, unknown>;
  if (typeof chunk.file !== "string" || !FILE.test(chunk.file)) return fail(`${key} has no valid file`);
  for (const field of ["imports", "css", "assets"] as const) {
    if (chunk[field] !== undefined && !isList(chunk[field])) fail(`${key}.${field} is not a list of strings`);
  }
  return chunk as Chunk;
}

/** Every file a chunk emits, each checked against the file-name shape. */
function emitted(chunk: Chunk): string[] {
  const files = [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])];
  for (const file of files) if (!FILE.test(file)) fail(`file name ${JSON.stringify(file)} is not assets/<name>`);
  return files;
}

/** An island's chunk and its static imports' chunks, in that order. */
function islandFiles(chunks: Map<string, Chunk>, chunk: Chunk): string[] {
  const files = [chunk.file];
  for (const key of chunk.imports ?? []) files.push((chunks.get(key) ?? fail(`unknown import ${key}`)).file);
  return files;
}

/** Parses a manifest's JSON text, relative to `dir`, into a WebBuild. */
export function parseWebBuild(text: string, dir: string): WebBuild {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("not an object");
  const chunks = new Map(Object.entries(raw).map(([key, value]) => [key, chunkOf(key, value)] as const));
  const files = new Map<string, string>();
  const islands = new Map<string, readonly string[]>();
  for (const [key, chunk] of chunks) {
    for (const file of emitted(chunk)) files.set(file.slice("assets/".length), join(dir, file));
    if (ISLAND.test(key)) islands.set(islandName(key), islandFiles(chunks, chunk));
  }
  const boot = chunks.get(BOOT_SOURCE);
  if (boot?.isEntry !== true) return fail(`${BOOT_SOURCE} is not an entry`);
  return { manifest: { boot: boot.file, islands }, files };
}

/** Reads `<dir>/.vite/manifest.json`; throws when it is missing or malformed, so startup fails closed. */
export function loadWebBuild(dir: string): WebBuild {
  return parseWebBuild(readFileSync(join(dir, MANIFEST), "utf8"), dir);
}
