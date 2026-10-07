// shared/ui-build stays loadable by plain Node (P1.25h; architecture record 2026-10-07-p125-ui-build-workspace.md and
// its 13:10Z amendment). Node 26 strips types from .ts but refuses .tsx, and shared/ui's index reaches the kit's .tsx
// components, so this workspace has no .tsx file, no react import, and reaches @unset/shared-ui only through a
// whole-statement `import type { ... }`, which Node erases entirely. `import { type X }` is refused: under
// verbatimModuleSyntax it leaves `import {} from` behind, which still loads the module.
// Imports are matched on where they resolve, so a subpath, a relative path into shared/ui or react-dom are caught too
// (P1.25d). ui_build_entries_run_in_node (scripts/ui/entries.test.ts) is the end-to-end proof.
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { expect, test } from "vitest";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "..", "..");
const KIT_DIR = resolve(HERE, "..", "ui");
/** Every module specifier: `from "x"`, `import "x"` and `import("x")`, the forms a Node module can load through. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
/** The one allowed way in: a whole `import type` statement from the kit's index, which Node erases. */
const KIT_TYPE_IMPORT = /^import type \{[^}]*\} from "@unset\/shared-ui";$/gm;
const REACT = /^react(?:-dom)?(?:\/.*)?$/;

type Source = { path: string; text: string };

/**
 * Where `specifier`, written in `file`, points on disk: a relative path from the file's folder, a workspace package
 * (`@unset/...`, with any subpath) through its node_modules link, or undefined for any other package.
 */
function resolved(specifier: string, file: string): string | undefined {
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  const workspace = /^(@unset\/[^/]+)(\/.*)?$/.exec(specifier);
  if (workspace === null) return undefined;
  const [, name = "", subpath = ""] = workspace;
  return join(realpathSync(join(ROOT, "node_modules", name)), subpath);
}

const inKit = (path: string | undefined): boolean =>
  path !== undefined && (path === KIT_DIR || path.startsWith(KIT_DIR + sep));

function jsxFreeProblems(sources: Source[]): string[] {
  return sources.flatMap(({ path, text }) => {
    const problems: string[] = [];
    if (path.endsWith(".tsx")) problems.push(`${path}: .tsx file`);
    const specifiers = [...text.matchAll(SPECIFIER)].map((m) => m[1] ?? "");
    if (specifiers.some((s) => REACT.test(s))) problems.push(`${path}: imports react`);
    const kit = specifiers.filter((s) => inKit(resolved(s, join(HERE, path)))).length;
    const typeOnly = text.match(KIT_TYPE_IMPORT)?.length ?? 0;
    if (kit !== typeOnly) problems.push(`${path}: reaches shared/ui other than by a whole "import type" of its index`);
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

test("ui_build_jsx_free_check_resolves", () => {
  // Forms the text match missed (P1.25d): each reaches shared/ui or react by a path other than the bare name.
  for (const text of [
    'import { safeHref } from "@unset/shared-ui/islands/safe-href.ts";\n',
    'import { safeHref } from "../ui/islands/safe-href.ts";\n',
    'import type { FontMetrics } from "../ui/index.ts";\n',
    'import { createRoot } from "react-dom/client";\n',
    'import { jsx } from "react/jsx-runtime";\n',
  ]) {
    expect(jsxFreeProblems([{ path: "a.ts", text }]), text).toHaveLength(1);
  }
  // Neighbours that only look alike stay allowed: this workspace's own files and a package named like the kit.
  for (const text of [
    'import { runTokens } from "./tokens.ts";\n',
    'import { runTokens } from "../ui-build/tokens.ts";\n',
    'import { x } from "react-markdown";\n',
  ]) {
    expect(jsxFreeProblems([{ path: "a.ts", text }]), text).toEqual([]);
  }
});
