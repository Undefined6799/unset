// The icon build (P1.24i; architecture record 2026-10-06-p116-retention-usage-and-p124-icon-source.md, follow-up
// 20:10Z): the committed Iconoir files equal the sheet's ICONS data, the sheet's bundle is parsed and never run, and
// nothing outside the element and attribute allowlist gets through.
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { ICONOIR_VERSION, type IconsIo, parseSvg, runIcons, sheetDrawings } from "./icons.ts";

const UI = join(import.meta.dirname, "..");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A copy of shared/ui's icon inputs and output, to break without touching the repository. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "icons-"));
  temps.push(root);
  for (const dir of ["sheet", "icons"]) cpSync(join(UI, dir), join(root, dir), { recursive: true });
  return root;
}
/** node:fs bound to one shared/ui root, as scripts/ui/icons.ts binds it. */
const fileIo = (root: string): IconsIo => ({
  readText: (path) => readFileSync(join(root, path), "utf8"),
  sha256: (path) =>
    createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex"),
  list: (dir) => readdirSync(join(root, dir)),
  writeText: (path, text) => writeFileSync(join(root, path), text),
});
const run = (root: string, args: string[]) => {
  const lines: string[] = [];
  return { code: runIcons(args, fileIo(root), (l) => lines.push(l)), lines };
};
/** Rewrites one file in a copy and records its new hash in source.json, so only the check under test can fail. */
function rewrite(root: string, path: string, edit: (text: string) => string): void {
  writeFileSync(join(root, path), edit(readFileSync(join(root, path), "utf8")));
  const source = JSON.parse(readFileSync(join(root, "sheet/source.json"), "utf8"));
  for (const file of source.files) if (file.path === path) file.sha256 = fileIo(root).sha256(path);
  writeFileSync(join(root, "sheet/source.json"), JSON.stringify(source));
}
const code = (result: { lines: string[] }) => result.lines.map((l) => l.split(":")[0]);

test("icon_allowlist_matches_sheet", () => {
  const result = run(UI, ["--check"]);
  expect(result.lines).toEqual([]);
  expect(result.code).toBe(0);
  const json = JSON.parse(readFileSync(join(UI, "icons/icons.json"), "utf8"));
  expect(json.iconoirVersion).toBe("7.12.1");
  expect(ICONOIR_VERSION).toBe("7.12.1");
  expect(Object.keys(json.icons)).toHaveLength(36);
  const licence = readFileSync(join(UI, "icons/LICENSE-iconoir.txt"), "utf8");
  expect(licence).toMatch(/^MIT License/);
  expect(licence).toContain("Copyright (c) 2021 Luca Burgio");
});

test("icon_check_detects_stale_output", () => {
  const root = copy();
  writeFileSync(join(root, "icons/icons.json"), "{}\n");
  expect(code(run(root, ["--check"]))).toEqual(["icons.stale"]);
  expect(run(root, []).code).toBe(0);
  expect(run(root, ["--check"]).code).toBe(0);
});

test("icon_bundle_hash_pinned", () => {
  const root = copy();
  writeFileSync(join(root, "sheet/bundle.js.txt"), `${readFileSync(join(root, "sheet/bundle.js.txt"), "utf8")}\n`);
  expect(code(run(root, ["--check"]))).toEqual(["icons.source_mismatch"]);
});

test("icon_drawing_differs_from_sheet_fails", () => {
  const root = copy();
  writeFileSync(
    join(root, "icons/svg/next.svg.txt"),
    readFileSync(join(root, "icons/svg/next.svg.txt"), "utf8").replace("M3 12", "M4 12"),
  );
  expect(code(run(root, ["--check"]))).toEqual(["icons.drawing_mismatch"]);
});

test("icon_list_must_equal_readme", () => {
  const extra = copy();
  cpSync(join(extra, "icons/svg/next.svg.txt"), join(extra, "icons/svg/arrow.svg.txt"));
  expect(code(run(extra, ["--check"]))).toEqual(["icons.list_mismatch"]);

  const short = copy();
  rewrite(short, "sheet/components/Icon/README.md", (t) => t.replace(/^\| `signout` .*\n/m, ""));
  expect(code(run(short, ["--check"]))).toEqual(["icons.parse"]);
});

test("icons_bundle_not_executed", () => {
  const marker = "__iconsBundleRan";
  const g = globalThis as Record<string, unknown>;
  const bundle = (icons: string) =>
    `globalThis.${marker} = true;\n(function () {\n  var ICONS = ${icons};\n  globalThis.${marker} = true;\n})();\n`;
  // A literal ICONS parses, and the code around it is never run.
  expect(sheetDrawings(bundle('{"next": [["path", {"d": "M0 0"}]]}'))).toEqual({ next: [["path", { d: "M0 0" }]] });
  // Anything that is not a literal fails: a call, a computed key, a spread, a template, an identifier.
  for (const icons of [
    `{"next": (globalThis.${marker} = true)}`,
    `{[globalThis.${marker} = "next"]: []}`,
    `{...globalThis}`,
    '{"next": [[`path`, {}]]}',
    '{"next": [["path", {"d": D}]]}',
  ])
    expect(() => sheetDrawings(bundle(icons)), icons).toThrow(/icons\.parse/);
  expect(g[marker]).toBeUndefined();
});

test("icons_bundle_slice_boundaries", () => {
  expect(sheetDrawings('var ICONS = {"a": []};\nvar X = 1;\n')).toEqual({ a: [] });
  for (const bundle of [
    'var ICON = {"a": []};\n',
    'var ICONS = {"a": []}',
    'var ICONS = {"a": []};\nvar ICONS = {"b": []};\n',
    'var ICONS = {"a": []}; foo();\n',
  ])
    expect(() => sheetDrawings(bundle), bundle).toThrow(/icons\.parse/);
});

test("icon_svg_allowlist_enforced", () => {
  const root =
    '<svg width="24" height="24" viewBox="0 0 24 24" stroke-width="1.5" fill="none" xmlns="http://www.w3.org/2000/svg">';
  const path = '<path d="M0 0" stroke="currentColor"/>';
  expect(parseSvg("ok", `${root}\n${path}\n</svg>\n`)).toEqual([["path", { d: "M0 0", stroke: "currentColor" }]]);
  for (const body of [
    "<script>alert(1)</script>",
    '<path d="M0 0" onload="alert(1)"/>',
    '<path d="M0 0" style="fill:red"/>',
    '<path d="M0 0" href="https://example.com/"/>',
    '<use href="#a"/>',
    "<foreignObject></foreignObject>",
    '<image href="x.png"/>',
  ])
    expect(() => parseSvg("bad", `${root}\n${body}\n</svg>\n`), body).toThrow(/icons\.drawing_mismatch/);
  expect(() => parseSvg("bad", `${root.replace("<svg ", '<svg onload="x" ')}\n${path}\n</svg>\n`)).toThrow(
    /icons\.drawing_mismatch/,
  );
  // The sheet side is held to the same allowlist.
  for (const icons of [
    '{"next": [["script", {}]]}',
    '{"next": [["path", {"onClick": "x"}]]}',
    '{"next": [["path", {"style": "x"}]]}',
  ])
    expect(() => sheetDrawings(`var ICONS = ${icons};\n`), icons).toThrow(/icons\.parse/);
});
