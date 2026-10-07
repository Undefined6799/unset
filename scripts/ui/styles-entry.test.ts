// The styles entry emits CSS only (P1.24j; architecture record 2026-10-07-p124j-island-slots-and-styles-budget.md,
// section 2): its JS is a few bytes, so it no longer weighs in the island JS total, and its one CSS file still holds
// every CSS Module's classes, those an island also imports included. The real browser build runs from
// apps/web/vite.config.ts into a temporary directory. It sits beside css-scope.ts because apps/web's own project may
// not reference scripts/ (the boundary MATRIX), as web-css.test.ts does.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { afterAll, expect, test } from "vitest";
import { REPO_ROOT, scopedName } from "./css-scope.ts";

const WEB = join(REPO_ROOT, "apps", "web");
const out = mkdtempSync(join(tmpdir(), "web-client-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

type Chunk = { file: string; src?: string; isEntry?: boolean; imports?: string[]; css?: string[] };

/** Every class a CSS Module declares, as the build names it. */
function scopedClasses(file: string): string[] {
  const source = readFileSync(file, "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set(source.matchAll(/(?<![\w.])\.([a-zA-Z][\w-]*)/g).map((match) => match[1] ?? ""));
  return [...names].map((name) => scopedName(name, file));
}

test("styles_entry_emits_css_only", async () => {
  await build({ configFile: join(WEB, "vite.config.ts"), root: WEB, logLevel: "silent", build: { outDir: out } });
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
}, 60_000);
