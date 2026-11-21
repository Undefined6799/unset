// Every file a dependency-cruiser rule names exactly is on the tree (P1.38v). A rule that allows or forbids a path
// nobody has silently stops meaning anything: app-build-config-imports went on allowing scripts/ui/css-scope.ts
// after a25d62a (#1684) removed it (issues #1775, #1781).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { config, ROOT } from "./depcruise-fixture.ts";

// Paths a rule names ahead of their folder, each with the reason it stays.
const NOT_YET_ON_THE_TREE: Record<string, string> = {
  // RENDER_ENTRIES.admin: the admin app's render entry, kept for interfaces/admin (CLAUDE.md, "Where does this go").
  "apps/admin/render.tsx": "admin app not built yet",
};

const REGEX_SYNTAX = /[\\*+?()[\]{}|^$]/;

/**
 * The exact repository files in one rule pattern: `^a/b\.ts$` or `^(a/b\.ts|c/d\.ts)$`, never a prefix or
 * wildcard. A `path` can also match a module name (a Node built-in, `#kit/handler`, `@scope/pkg`); those hold no
 * slash or start with `#` or `@`, and are not files.
 */
function exactFiles(pattern: string): string[] {
  const whole = /^\^\((.*)\)\$$/.exec(pattern)?.[1] ?? /^\^(.*)\$$/.exec(pattern)?.[1];
  if (whole === undefined) return [];
  const alternatives = whole.split("|");
  const paths = alternatives.map((a) => a.replaceAll("\\.", "."));
  const files = paths.every((p) => p.length > 0 && !REGEX_SYNTAX.test(p)) ? paths : [];
  return files.filter((p) => p.includes("/") && !/^[#@]/.test(p));
}

/** Every `path` and `pathNot` pattern in a rule list; module names under other keys are not files. */
function pathPatterns(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(pathPatterns);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) =>
    key === "path" || key === "pathNot" ? [v].flat().filter((x) => typeof x === "string") : pathPatterns(v),
  );
}

test("exact_files_reads_only_exact_paths", () => {
  expect(exactFiles("^scripts/ui/css-scope\\.ts$")).toEqual(["scripts/ui/css-scope.ts"]);
  expect(exactFiles("^(a/b\\.ts|c/d\\.ts)$")).toEqual(["a/b.ts", "c/d.ts"]);
  expect(exactFiles("^interfaces/web/src/lib/server/")).toEqual([]);
  expect(exactFiles("^apps/([^/]+)/vite\\.config\\.ts$")).toEqual([]);
  expect(exactFiles("^interfaces/web/src/routes/.*\\.server\\.ts$")).toEqual([]);
  expect(exactFiles("^(fs|path)$")).toEqual([]);
  expect(exactFiles("^(#kit/handler|@scope/pkg)$")).toEqual([]);
});

test("depcruise_rules_name_only_files_on_the_tree", () => {
  const named = new Set(pathPatterns([config.allowed, config.forbidden]).flatMap(exactFiles));
  const missing = [...named].filter((p) => !existsSync(join(ROOT, p)) && !(p in NOT_YET_ON_THE_TREE));
  expect(missing).toEqual([]);
  // An exception that has since landed, or that no rule names any more, is removed from the list.
  for (const p of Object.keys(NOT_YET_ON_THE_TREE)) {
    expect(named.has(p) && !existsSync(join(ROOT, p)), p).toBe(true);
  }
});
