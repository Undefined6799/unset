// The island registry (P1.23; plan §5.1): one island per `*.island.tsx` under apps/web/src/islands/ or
// shared/ui/islands/, named by its file stem. The build finds the files (Vite's import.meta.glob, in render.tsx for
// the server and bootstrap.ts for the browser), so there is no hand-kept list to drift from the files.

/** An island name: P1.10's props-id shape, so it is safe in an attribute, a log line and a manifest key. */
const NAME = /^[a-z][a-z0-9-]{0,40}$/;
const ISLAND_FILE = /(?:^|\/)([^/]+)\.island\.tsx$/;

/** The island name of a module path, or an error for a file that does not follow the convention. */
export function islandName(path: string): string {
  const stem = ISLAND_FILE.exec(path)?.[1];
  if (stem === undefined || !NAME.test(stem)) throw new Error(`not an island file name: ${path}`);
  return stem;
}

/** Keys a glob result by island name. Two files with one stem (one in apps/web, one in shared/ui) are refused. */
export function byName<T>(modules: Readonly<Record<string, T>>): ReadonlyMap<string, T> {
  const named = new Map<string, T>();
  for (const [path, value] of Object.entries(modules)) {
    const name = islandName(path);
    if (named.has(name)) throw new Error(`two islands are named ${name}`);
    named.set(name, value);
  }
  return named;
}
