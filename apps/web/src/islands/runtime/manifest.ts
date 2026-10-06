// The parts of the browser build a page needs (P1.23). interfaces/http reads and validates Vite's manifest once at
// startup and passes this through render.tsx, so apps/web never touches the file system (architecture ruling
// 2026-10-06, 2026-10-06-p123-islands-runtime-placement.md).

/** Built file names, each `assets/<name>`, relative to ASSETS_BASE's origin. */
export type BuildManifest = Readonly<{
  /** The bootstrap module. */
  boot: string;
  /** The CSS the styles entry emitted (every CSS Module, P1.23c), linked by every page in this order. */
  styles: readonly string[];
  /** Per island name: its chunk and the chunks it imports statically, the chunk first. */
  islands: ReadonlyMap<string, readonly string[]>;
}>;

/** The modulepreload files for the islands a page used, each once, leaving out what the bootstrap loads anyway. */
export function preloadsFor(manifest: BuildManifest, used: Iterable<string>): string[] {
  const files = new Set<string>();
  for (const name of used) for (const file of manifest.islands.get(name) ?? []) files.add(file);
  files.delete(manifest.boot);
  return [...files];
}
