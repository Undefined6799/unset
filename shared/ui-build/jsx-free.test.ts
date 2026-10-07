// shared/ui-build stays loadable by plain Node (P1.25h; architecture record 2026-10-07-p125-ui-build-workspace.md and
// its 13:10Z amendment). Node 26 strips types from .ts but refuses .tsx, and shared/ui's index reaches the kit's .tsx
// components, so this workspace has no .tsx file, no react import, and reaches @unset/shared-ui only through a
// whole-statement `import type { ... }`, which Node erases entirely. `import { type X }` is refused: under
// verbatimModuleSyntax it leaves `import {} from` behind, which still loads the module.
// Each file is parsed (oxc through vite 8.3.1's parseSync, as scripts/budgets/count-glue-lines.ts does), so comments,
// quotes and line breaks cannot hide an import (P1.25r; architecture's N4 amendment, 2026-10-07-p125h-follow-ups.md,
// and its parser note). No string may name the kit except the specifier of that `import type`; require, createRequire
// and import() of anything but a literal are refused; a relative import must resolve, through symlinks, inside this
// workspace. ui_build_entries_run_in_node (scripts/ui/entries.test.ts) is the end-to-end proof.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { parseSync } from "vite";
import { expect, test } from "vitest";

const HERE = realpathSync(import.meta.dirname);
const ROOT = resolve(HERE, "..", "..");
const KIT_DIR = realpathSync(resolve(HERE, "..", "ui"));
const KIT = "@unset/shared-ui";
const REACT = /^react(?:-dom)?(?:\/.*)?$/;
const DECLARATIONS = new Set(["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"]);
/** Names that load a module outside the static import graph (rule 2), refused wherever they appear. */
const LOADERS = new Set(["require", "createRequire"]);
/** The parse settings each scanned extension takes (oxc `ParserOptions`, rolldown 1.2.12). */
const PARSE: Record<string, { lang: "ts" | "tsx"; sourceType: "module" | "commonjs" }> = {
  ".ts": { lang: "ts", sourceType: "module" },
  ".mts": { lang: "ts", sourceType: "module" },
  ".cts": { lang: "ts", sourceType: "commonjs" },
  ".tsx": { lang: "tsx", sourceType: "module" },
};

type Source = { path: string; text: string };
type Node = { type: string; [key: string]: unknown };

/** The kit's exact name or a path under it; `@unset/shared-uix` is another package. */
const namesKit = (value: string): boolean => value === KIT || value.startsWith(`${KIT}/`);
const within = (path: string, dir: string): boolean => path === dir || path.startsWith(dir + sep);

/** Every node of a parsed tree, depth first. */
function* nodes(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {
    for (const child of value) yield* nodes(child);
  } else if (value !== null && typeof value === "object") {
    if (typeof (value as Node).type === "string") yield value as Node;
    for (const [key, child] of Object.entries(value)) if (key !== "parent") yield* nodes(child);
  }
}

/** The value of a string literal or a no-substitution template literal, else undefined. */
function stringValue(node: Node): string | undefined {
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node.type !== "TemplateLiteral" || (node.expressions as unknown[]).length > 0) return undefined;
  return (node.quasis as { value: { cooked: string } }[])[0]?.value.cooked;
}

/** The parsed tree of `path`, or the reason it cannot be read; a file that does not parse is never "no imports". */
function parsed(path: string, text: string): { program: unknown } | { problem: string } {
  const settings = PARSE[extname(path)];
  if (settings === undefined) return { problem: `${path}: not a .ts, .tsx, .mts or .cts file` };
  const { program, errors } = parseSync(path, text, settings);
  if (errors.length > 0) return { problem: `${path}: does not parse: ${errors[0]?.message}` };
  return { program };
}

/** Every string literal value in `text`, in order: the parser leaves comments out. */
function stringsIn(path: string, text: string): string[] {
  const tree = parsed(path, text);
  if ("problem" in tree) throw new Error(tree.problem);
  return [...nodes(tree.program)].map(stringValue).filter((value) => value !== undefined);
}

/** Where a relative specifier lands, through symlinks; undefined when nothing is there. */
function landing(specifier: string, file: string): string | undefined {
  const target = resolve(dirname(file), specifier);
  return existsSync(target) ? realpathSync(target) : undefined;
}

/** What is wrong with one module specifier written in `path`. */
function specifierProblems(path: string, specifier: string): string[] {
  if (REACT.test(specifier)) return [`${path}: imports react`];
  if (specifier.startsWith(".")) {
    const target = landing(specifier, join(HERE, path));
    if (target === undefined) return [`${path}: "${specifier}" resolves to nothing`];
    const inside = within(target, HERE) && !target.includes(`${sep}node_modules${sep}`);
    return inside ? [] : [`${path}: "${specifier}" leaves shared/ui-build`];
  }
  if (namesKit(specifier)) return []; // the string floor refuses it, once
  const workspace = /^@unset\/[^/]+/.exec(specifier)?.[0];
  const link = workspace === undefined ? undefined : join(ROOT, "node_modules", workspace);
  if (link !== undefined && existsSync(link) && within(realpathSync(link), KIT_DIR)) {
    return [`${path}: "${specifier}" reaches shared/ui`];
  }
  return [];
}

/**
 * Rules 2 to 4 for one node. The kit specifier of a whole `import type` (rule 1's one exception) is recorded in
 * `allowed` instead.
 */
function nodeProblems(path: string, node: Node, allowed: Set<unknown>): string[] {
  const source = node.source as Node | null | undefined;
  if (DECLARATIONS.has(node.type) && source) {
    const specifier = stringValue(source) ?? "";
    if (node.type !== "ImportDeclaration" || node.importKind !== "type" || specifier !== KIT) {
      return specifierProblems(path, specifier);
    }
    allowed.add(source);
    return [];
  }
  if (node.type === "ImportExpression") {
    const specifier = source ? stringValue(source) : undefined;
    if (specifier === undefined) return [`${path}: import() of something other than a literal`];
    return specifierProblems(path, specifier);
  }
  if (node.type === "TSExternalModuleReference") return [`${path}: import = require(...)`];
  if (node.type === "Identifier" && LOADERS.has(node.name as string)) return [`${path}: uses ${node.name as string}`];
  return [];
}

/** The four rules of the N4 amendment for one file. */
function fileProblems({ path, text }: Source): string[] {
  const problems: string[] = [];
  if (path.endsWith(".tsx")) problems.push(`${path}: .tsx file`);
  const tree = parsed(path, text);
  if ("problem" in tree) return [...problems, tree.problem];
  const allowed = new Set<unknown>();
  for (const node of nodes(tree.program)) problems.push(...nodeProblems(path, node, allowed));
  for (const node of nodes(tree.program)) {
    const value = stringValue(node);
    if (value !== undefined && namesKit(value) && !allowed.has(node)) {
      problems.push(`${path}: names ${KIT} other than as the specifier of a whole "import type" of its index`);
    }
  }
  return problems;
}

function jsxFreeProblems(sources: Source[]): string[] {
  return sources.flatMap(fileProblems);
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
  // Neighbours that only look alike stay allowed: this workspace's own files and a package named like react.
  for (const text of [
    'import { runTokens } from "./tokens.ts";\n',
    'import { runTokens } from "../ui-build/tokens.ts";\n',
    'import { x } from "react-markdown";\n',
  ]) {
    expect(jsxFreeProblems([{ path: "a.ts", text }]), text).toEqual([]);
  }
});

test("ui_build_jsx_free_check_parses", () => {
  // Forms #512's specifier regex let through, and the loading primitives refused outright (P1.25r; architecture's N4
  // amendment, 2026-10-07 22:55Z).
  for (const [path, text] of [
    [
      "a.ts",
      'import { createRequire } from "node:module";\nconst kit = createRequire(import.meta.url)("@unset/shared-ui");\n',
    ],
    ["a.cts", 'const kit = require("@unset/shared-ui");\n'],
    ["a.cts", 'const fs = require("node:fs");\n'],
    ["a.ts", 'const name = "@unset/shared-ui";\nconst kit = await import(name);\n'],
    ["a.ts", "const kit = await import(`@unset/shared-ui`);\n"],
    ["a.ts", 'const name = "./tokens.ts";\nconst tokens = await import(name);\n'],
    ["a.ts", '// we never import \'raw files\nimport { safeHref } from "@unset/shared-ui";\n'],
    ["a.ts", 'import { safeHref } from "../../node_modules/@unset/shared-ui/safe-href.ts";\n'],
    ["a.ts", 'import { jsx } from "../../node_modules/react/jsx-runtime.js";\n'],
    ["a.ts", 'import { nothing } from "./no-such-file.ts";\n'],
    ["a.ts", 'const m = module.require("node:fs");\n'],
    ["a.ts", 'export type { FontMetrics } from "@unset/shared-ui";\n'],
    ["a.ts", 'import type { FontMetrics } from "@unset/shared-ui/index.ts";\n'],
  ] as [string, string][]) {
    expect(jsxFreeProblems([{ path, text }]), text).not.toEqual([]);
  }
  for (const text of [
    'import type { FontMetrics } from "@unset/shared-ui";\n',
    "// it's this workspace's own file\nimport { runTokens } from \"./tokens.ts\";\n",
    'const other = "@unset/shared-uix";\n',
  ]) {
    expect(jsxFreeProblems([{ path: "a.ts", text }]), text).toEqual([]);
  }
  // A comment naming the kit, with a stray quote, is no string at all to the parser (architecture's parser note).
  const comment = '// see \'@unset/shared-ui for the kit\nimport { runTokens } from "./tokens.ts";\n';
  expect(stringsIn("a.ts", comment)).toEqual(["./tokens.ts"]);
  expect(jsxFreeProblems([{ path: "a.ts", text: comment }])).toEqual([]);
  // A file that does not parse fails; it never counts as having no imports. Each extension parses as its own kind.
  expect(jsxFreeProblems([{ path: "a.ts", text: 'import { from "@unset/shared-ui"\n' }])).toHaveLength(1);
  expect(jsxFreeProblems([{ path: "a.ts", text: "const a = <b />;\n" }])).toHaveLength(1);
  expect(jsxFreeProblems([{ path: "a.mts", text: "export const a = 1;\n" }])).toEqual([]);
  expect(jsxFreeProblems([{ path: "a.js", text: "" }])).toHaveLength(1);
});
