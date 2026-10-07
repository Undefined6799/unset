// shared/ui-build stays loadable by plain Node (P1.25h; architecture record 2026-10-07-p125-ui-build-workspace.md and
// its 13:10Z amendment). Node 26 strips types from .ts but refuses .tsx, and shared/ui's index reaches the kit's .tsx
// components, so this workspace has no .tsx file, no react import, and reaches @unset/shared-ui only through a
// whole-statement `import type { ... }`, which Node erases entirely. `import { type X }` is refused: under
// verbatimModuleSyntax it leaves `import {} from` behind, which still loads the module.
// ui_build_entries_run_in_node (scripts/ui/entries.test.ts) is the end-to-end proof.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const HERE = import.meta.dirname;
const KIT = /["']@unset\/shared-ui["']/g;
const KIT_TYPE_IMPORT = /^import type \{[^}]*\} from "@unset\/shared-ui";$/gm;
const REACT = /(?:from\s+|import\s*\(?\s*)["']react(?:\/[^"']*)?["']/;

type Source = { path: string; text: string };

function jsxFreeProblems(sources: Source[]): string[] {
  return sources.flatMap(({ path, text }) => {
    const problems: string[] = [];
    if (path.endsWith(".tsx")) problems.push(`${path}: .tsx file`);
    if (REACT.test(text)) problems.push(`${path}: imports react`);
    const kit = text.match(KIT)?.length ?? 0;
    const typeOnly = text.match(KIT_TYPE_IMPORT)?.length ?? 0;
    if (kit !== typeOnly) problems.push(`${path}: reaches @unset/shared-ui other than by a whole "import type"`);
    return problems;
  });
}

function workspaceSources(dir: string): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", "dist"].includes(entry.name) ? [] : workspaceSources(path);
    // This file's own fixtures quote the forms it refuses; ui_build_jsx_free_check_refuses covers it.
    if (!/\.(?:ts|tsx|mts|cts)$/.test(entry.name) || path === import.meta.filename) return [];
    return [{ path: relative(HERE, path), text: readFileSync(path, "utf8") }];
  });
}

test("ui_build_is_jsx_free", () => {
  const sources = workspaceSources(HERE);
  expect(sources.map((s) => s.path)).toContain("index.ts");
  expect(jsxFreeProblems(sources)).toEqual([]);
});

test("ui_build_jsx_free_check_refuses", () => {
  const typeOnly = 'import type { FontMetrics } from "@unset/shared-ui";\n';
  expect(jsxFreeProblems([{ path: "a.ts", text: typeOnly }])).toEqual([]);
  for (const text of [
    'import { type FontMetrics } from "@unset/shared-ui";\n',
    'import { safeHref } from "@unset/shared-ui";\n',
    'export type { FontMetrics } from "@unset/shared-ui";\n',
    'import "@unset/shared-ui";\n',
    'const kit = await import("@unset/shared-ui");\n',
  ]) {
    expect(jsxFreeProblems([{ path: "a.ts", text }]), text).toHaveLength(1);
  }
  expect(jsxFreeProblems([{ path: "a.ts", text: 'import { jsx } from "react/jsx-runtime";\n' }])).toHaveLength(1);
  expect(jsxFreeProblems([{ path: "a.tsx", text: "" }])).toHaveLength(1);
});
