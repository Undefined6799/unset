// Production runs apps/web's server build, never its source (P1.23c; architecture Amendment 2026-10-06 21:05Z): the
// static import graph of the production entry reaches no file under apps/. Type-only imports are erased and the
// loader's import() of the built file is not a source edge, so both are left out of the walk.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { expect, test } from "vitest";

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const { options } = createRequire(import.meta.url)("../../scripts/lint/.dependency-cruiser.cjs");
const ENTRY = "interfaces/http/main.ts";
const ERASED = new Set(["type-only", "dynamic-import"]);

/** Every module the entry reaches through imports that run, as repository-relative paths. */
async function staticGraph(entry: string): Promise<Set<string>> {
  const { output } = await cruise([entry], { ...options, baseDir: REPOSITORY, outputType: "json" });
  const { modules }: ICruiseResult = JSON.parse(String(output));
  const edges = new Map(modules.map((m) => [m.source, m.dependencies]));
  const seen = new Set([entry]);
  for (const source of seen) {
    for (const d of edges.get(source) ?? []) {
      if (d.dependencyTypes.some((type) => ERASED.has(type)) || d.coreModule) continue;
      seen.add(d.resolved);
    }
  }
  return seen;
}

test("prod_entry_imports_no_app_source", async () => {
  const graph = await staticGraph(ENTRY);
  expect(graph).toContain("interfaces/http/web/render-entry.ts");
  expect([...graph].filter((path) => path.startsWith("apps/"))).toEqual([]);
}, 30_000);
