// The build's JSX runtime and P1.23q's island allowlist name the same module (architecture ruling 2026-10-06): if
// one changed alone, islands would either fail the boundary rule or import a module it never reviewed.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "vitest";

const RUNTIME = "react/jsx-runtime";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("jsx_runtime_matches_island_allowlist", () => {
  expect(read("./vite.config.ts")).toContain(
    'jsx: { runtime: "automatic", importSource: "react", development: false }',
  );
  const tsconfig = JSON.parse(read("./tsconfig.json")) as { compilerOptions: Record<string, string> };
  expect([tsconfig.compilerOptions.jsx, tsconfig.compilerOptions.jsxImportSource]).toEqual(["react-jsx", "react"]);

  const cruiser = createRequire(import.meta.url)("../../scripts/lint/.dependency-cruiser.cjs") as {
    forbidden: { name: string; to: { pathNot?: string[] } }[];
  };
  const rule = cruiser.forbidden.find((r) => r.name === "island-import-boundary");
  const allowed = (rule?.to.pathNot ?? []).filter((source) => !source.startsWith("^shared/"));
  expect(allowed.some((source) => new RegExp(source).test(`node_modules/${RUNTIME}.js`))).toBe(true);
  expect(allowed.some((source) => new RegExp(source).test("node_modules/react/jsx-dev-runtime.js"))).toBe(false);
});
