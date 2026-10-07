// shared/ui-build stays loadable by plain Node (P1.25h; architecture record 2026-10-07-p125-ui-build-workspace.md and
// its 13:10Z amendment). Node 26 strips types from .ts but refuses .tsx, and shared/ui's index reaches the kit's .tsx
// components, so this workspace has no .tsx file, no react import, and reaches @unset/shared-ui only through a
// whole-statement `import type { ... }`, which Node erases entirely. `import { type X }` is refused: under
// verbatimModuleSyntax it leaves `import {} from` behind, which still loads the module.
// Each file is parsed (oxc through vite 8.3.1's parseSync, as scripts/budgets/count-glue-lines.ts does), so comments,
// quotes and line breaks cannot hide an import (P1.25r, P1.25s; architecture's N4 amendment and its two notes,
// 2026-10-07-p125h-follow-ups.md). No string may contain the kit's name except the specifier of an
// `import type { ... }` of its index; require, createRequire, eval, Function, vm and import() of anything but a literal
// are refused; a relative import must resolve, through symlinks, inside this workspace and outside its node_modules.
// Splitting the name across a concatenation is out of reach for any text test; P1.25w's depcruise row is the fence.
// ui_build_entries_run_in_node (scripts/ui/entries.test.ts) is the end-to-end proof.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseSync } from "vite";
import { afterAll, expect, test } from "vitest";

const HERE = realpathSync(import.meta.dirname);
const KIT = "@unset/shared-ui";
/** The kit's name as a whole specifier inside any string: not followed by a character a new npm name can hold. */
const NAMES_KIT = /@unset\/shared-ui(?![a-z0-9._-])/;
const REACT = /^react(?:-dom)?(?:\/.*)?$/;
const DECLARATIONS = new Set(["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"]);
/** Names that load or run code outside the static import graph (rule 2), refused wherever they appear. */
const LOADERS = new Set(["require", "createRequire", "eval", "Function"]);
/** Node's module for running code strings, refused as an import (P1.25s). */
const VM = new Set(["vm", "node:vm"]);
/** The parse settings each scanned extension takes (oxc `ParserOptions`, rolldown 1.2.12). */
const PARSE: Record<string, { lang: "ts" | "tsx"; sourceType: "module" | "commonjs" }> = {
  ".ts": { lang: "ts", sourceType: "module" },
  ".mts": { lang: "ts", sourceType: "module" },
  ".cts": { lang: "ts", sourceType: "commonjs" },
  ".tsx": { lang: "tsx", sourceType: "module" },
};

type Source = { path: string; text: string };
type Node = { type: string; [key: string]: unknown };

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

/**
 * What is wrong with one module specifier written in `path`, a file of the workspace `dir`. A relative target is
 * judged on its path from `dir`, so a checkout that itself sits under a node_modules folder still passes.
 */
function specifierProblems(path: string, specifier: string, dir: string): string[] {
  if (REACT.test(specifier)) return [`${path}: imports react`];
  if (VM.has(specifier)) return [`${path}: imports "${specifier}"`];
  if (!specifier.startsWith(".")) return [];
  const target = landing(specifier, join(dir, path));
  if (target === undefined) return [`${path}: "${specifier}" resolves to nothing`];
  const fromDir = relative(dir, target);
  if (fromDir === ".." || fromDir.startsWith(`..${sep}`) || isAbsolute(fromDir)) {
    return [`${path}: "${specifier}" resolves outside the workspace`];
  }
  if (fromDir.split(sep).includes("node_modules")) return [`${path}: "${specifier}" resolves into node_modules`];
  return [];
}

/** The one allowed way in (rule 1): `import type { A, B } from "@unset/shared-ui"`, named specifiers only. */
function isNamedTypeImportOfKit(node: Node, specifier: string): boolean {
  if (node.type !== "ImportDeclaration" || node.importKind !== "type" || specifier !== KIT) return false;
  return (node.specifiers as Node[]).every((s) => s.type === "ImportSpecifier");
}

/**
 * Rules 2 to 4 for one node. The kit specifier of an allowed type import (rule 1's one exception) is recorded in
 * `allowed` instead.
 */
function nodeProblems(path: string, node: Node, dir: string, allowed: Set<unknown>): string[] {
  const source = node.source as Node | null | undefined;
  if (DECLARATIONS.has(node.type) && source) {
    const specifier = stringValue(source) ?? "";
    if (!isNamedTypeImportOfKit(node, specifier)) return specifierProblems(path, specifier, dir);
    allowed.add(source);
    return [];
  }
  if (node.type === "ImportExpression") {
    const specifier = source ? stringValue(source) : undefined;
    if (specifier === undefined) return [`${path}: import() of something other than a literal`];
    return specifierProblems(path, specifier, dir);
  }
  if (node.type === "TSExternalModuleReference") return [`${path}: import = require(...)`];
  if (node.type === "Identifier" && LOADERS.has(node.name as string)) return [`${path}: uses ${node.name as string}`];
  return [];
}

/** The four rules of the N4 amendment for one file of the workspace `dir`, each problem named once. */
function fileProblems({ path, text }: Source, dir: string): string[] {
  const problems: string[] = [];
  if (path.endsWith(".tsx")) problems.push(`${path}: .tsx file`);
  const tree = parsed(path, text);
  if ("problem" in tree) return [...problems, tree.problem];
  const allowed = new Set<unknown>();
  for (const node of nodes(tree.program)) problems.push(...nodeProblems(path, node, dir, allowed));
  for (const node of nodes(tree.program)) {
    const value = stringValue(node);
    if (value !== undefined && NAMES_KIT.test(value) && !allowed.has(node)) {
      problems.push(`${path}: names ${KIT} other than as the specifier of an "import type { … }" of its index`);
    }
  }
  return [...new Set(problems)];
}

function jsxFreeProblems(sources: Source[], dir: string = HERE): string[] {
  return sources.flatMap((source) => fileProblems(source, dir));
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

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway workspace at `<tmp>/<parent>/ws`: its own file, a real file under its own node_modules, and a symlink
 * `kit` into shared/ui. `parent` lets a checkout sit under a folder named node_modules.
 */
function scratchWorkspace(parent: string): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "jsx-free-")));
  temps.push(base);
  const dir = join(base, parent, "ws");
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "own.ts"), "export const own = 1;\n");
  writeFileSync(join(dir, "node_modules", "dep.ts"), "export const dep = 1;\n");
  symlinkSync(realpathSync(resolve(HERE, "..", "ui")), join(dir, "kit"));
  return dir;
}

test("ui_build_jsx_free_check_pins_each_check", () => {
  // P1.25s (architecture's second N4 note, 2026-10-07 23:25Z): each fixture is caught by exactly one check, so
  // removing that check turns this test red.
  const dir = scratchWorkspace("plain");
  const floor = 'a.ts: names @unset/shared-ui other than as the specifier of an "import type { … }" of its index';
  const pinned: [string, string, string[]][] = [
    [
      "realpath",
      'import { safeHref } from "./kit/safe-href.ts";\n',
      ['a.ts: "./kit/safe-href.ts" resolves outside the workspace'],
    ],
    [
      "node_modules segment",
      'import { dep } from "./node_modules/dep.ts";\n',
      ['a.ts: "./node_modules/dep.ts" resolves into node_modules'],
    ],
    ["import =", 'import fs = require("node:fs");\n', ["a.ts: import = require(...)"]],
    [
      "createRequire",
      'import { createRequire } from "node:module";\nexport const load = createRequire(import.meta.url);\n',
      ["a.ts: uses createRequire"],
    ],
    ["eval", 'eval("1 + 1");\n', ["a.ts: uses eval"]],
    ["indirect eval", '(0, eval)("1 + 1");\n', ["a.ts: uses eval"]],
    ["Function", 'Function("return 1")();\n', ["a.ts: uses Function"]],
    ["new Function", 'new Function("return 1")();\n', ["a.ts: uses Function"]],
    ["vm", 'import vm from "node:vm";\nvm.runInThisContext("1 + 1");\n', ['a.ts: imports "node:vm"']],
    ["vm, bare", 'const vm = await import("vm");\n', ['a.ts: imports "vm"']],
    ["contains-floor", "setTimeout('import(\"@unset/shared-ui\")', 0);\n", [floor]],
    ["named type imports only", 'import type * as K from "@unset/shared-ui";\n', [floor]],
    ["named type imports only", 'import type K from "@unset/shared-ui";\n', [floor]],
  ];
  for (const [check, text, problems] of pinned) {
    expect(jsxFreeProblems([{ path: "a.ts", text }], dir), check).toEqual(problems);
  }
  // The record's other red fixtures (amendment 3): caught, by one check or more.
  for (const text of [
    "eval('import(\"@unset/shared-ui\")');\n",
    "(0, eval)('import(\"@unset/shared-ui\")');\n",
    "Function('return import(\"@unset/shared-ui\")')();\n",
    "new Function('return import(\"@unset/shared-ui\")')();\n",
    'import type { FontMetrics } from "@unset/shared-ui";\nimport { safeHref } from "@unset/shared-ui";\n',
  ]) {
    expect(jsxFreeProblems([{ path: "a.ts", text }], dir), text).not.toEqual([]);
  }
  for (const text of [
    'import { own } from "./own.ts";\n',
    'const other = "@unset/shared-uix";\n',
    'import type { FontMetrics, FallbackFace } from "@unset/shared-ui";\n',
  ]) {
    expect(jsxFreeProblems([{ path: "a.ts", text }], dir), text).toEqual([]);
  }
  // A checkout whose own path holds a node_modules folder still accepts its own files.
  const nested = scratchWorkspace("node_modules");
  expect(jsxFreeProblems([{ path: "a.ts", text: 'import { own } from "./own.ts";\n' }], nested)).toEqual([]);
});
