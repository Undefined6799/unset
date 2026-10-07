// The styles entry emits CSS only (P1.24j; architecture record 2026-10-07-p124j-island-slots-and-styles-budget.md,
// section 2): its JS is a few bytes, so it no longer weighs in the island JS total, and its one CSS file still holds
// every CSS Module's classes, those an island also imports included. The real browser build runs from
// apps/web/vite.config.ts into a temporary directory. It sits beside css-scope.ts because apps/web's own project may
// not reference scripts/ (the boundary MATRIX), as web-css.test.ts does. The same build shows that no browser JS
// carries the icon map (P1.24b; architecture record 2026-10-07-p124b-island-icons.md).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { REPO_ROOT, scopedName } from "./css-scope.ts";

const WEB = join(REPO_ROOT, "apps", "web");
const out = mkdtempSync(join(tmpdir(), "web-client-"));
beforeAll(async () => {
  await build({ configFile: join(WEB, "vite.config.ts"), root: WEB, logLevel: "silent", build: { outDir: out } });
}, 60_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

type Chunk = { file: string; src?: string; isEntry?: boolean; imports?: string[]; css?: string[] };

/** Every class a CSS Module declares, as the build names it. */
function scopedClasses(file: string): string[] {
  const source = readFileSync(file, "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set(source.matchAll(/(?<![\w.])\.([a-zA-Z][\w-]*)/g).map((match) => match[1] ?? ""));
  return [...names].map((name) => scopedName(name, file));
}

test("styles_entry_emits_css_only", () => {
  const manifest = JSON.parse(readFileSync(join(out, ".vite/manifest.json"), "utf8")) as Record<string, Chunk>;
  const styles = manifest["src/styles.ts"];
  expect(styles?.isEntry).toBe(true);
  expect(styles?.imports ?? []).toEqual([]);
  expect(gzipSync(readFileSync(join(out, styles?.file ?? ""))).length).toBeLessThan(300);
  expect(styles?.css).toHaveLength(1);
  const css = readFileSync(join(out, styles?.css?.[0] ?? ""), "utf8");
  const modules = [join(WEB, "src"), join(REPO_ROOT, "shared", "ui", "components")].flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".module.css"))
      .map((file) => join(dir, file)),
  );
  expect(modules.length).toBeGreaterThan(30);
  const missing = modules.flatMap(scopedClasses).filter((name) => !css.includes(`.${name}`));
  expect(missing).toEqual([]);
});

test("island_bundle_has_no_icon_map", () => {
  const icons = JSON.parse(readFileSync(join(REPO_ROOT, "shared", "ui", "icons", "icons.json"), "utf8"));
  // signout is a sheet icon no island draws; its path data appears only if the whole map is bundled.
  const sentinel: string = icons.drawings.signout[0].d;
  const scripts = readdirSync(out, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".js"));
  expect(scripts.some((file) => /toast\.island/.test(file))).toBe(true);
  for (const file of scripts) {
    const code = readFileSync(join(out, file), "utf8");
    expect(code, file).not.toMatch(/iconoirVersion|sheetVersion/);
    expect(code.includes(sentinel), file).toBe(false);
  }
});
