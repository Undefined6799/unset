/// <reference types="vite/client" />
// The CSS Modules glue (P1.23c; ADR 0015; step book record 2026-10-06-p123c-css-modules-glue.md): apps/web's browser
// build, its server build and Vitest name every class with the one scopedName, so the class a server render emits is
// the selector in the CSS the page links. The two real builds run here from apps/web/vite.config.ts on a fixture
// module, through vite 8.3.1's `build()` and `resolveConfig()` (dist/node/index.d.ts), into temporary directories.
// It sits beside css-scope.ts because apps/web's own project may not reference scripts/ (the boundary MATRIX).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type InlineConfig, resolveConfig } from "vite";
import { afterAll, describe, expect, test } from "vitest";
import { REPO_ROOT, scopedName } from "./css-scope.ts";
import probe from "./fixtures/css/probe.module.css";

const WEB = join(REPO_ROOT, "apps", "web");
const PROBE = join(import.meta.dirname, "fixtures", "css", "probe.module.css");
const BASE: InlineConfig = { configFile: join(WEB, "vite.config.ts"), root: WEB, logLevel: "silent" };
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
/** A temporary directory holding the given files; the build entries live here, the CSS Module stays in the repo. */
function temp(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "web-css-"));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
type Scoped = (name: string, filename: string, css: string) => string;
const scopedFrom = async (config: InlineConfig) =>
  (await resolveConfig(config, "build")).css.modules as unknown as { generateScopedName: Scoped };

describe("CSS Modules glue", () => {
  test("scoped_name_deterministic", async () => {
    const expected = scopedName("root", PROBE);
    const browser = await scopedFrom(BASE);
    const server = await scopedFrom({ ...BASE, build: { ssr: "render.tsx" } });
    expect(browser.generateScopedName("root", PROBE, "")).toBe(expected);
    expect(server.generateScopedName("root", PROBE, "")).toBe(expected);
    // Vitest (root vitest.config.ts) compiles the same module to the same name.
    expect(probe.root).toBe(expected);
  });

  test("ssr_class_equals_client_selector", async () => {
    const module = JSON.stringify(PROBE);
    const entries = temp({
      "client.js": `import styles from ${module};\nexport default styles;\n`,
      // The server build's class map is what every server render reads its class names from.
      "server.js": `export { default as styles } from ${module};\n`,
    });
    const client = temp();
    const server = temp();
    await build({
      ...BASE,
      build: { outDir: client, rolldownOptions: { input: { probe: join(entries, "client.js") } } },
    });
    await build({ ...BASE, build: { outDir: server, ssr: join(entries, "server.js") } });

    const css = readdirSync(join(client, "assets"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(client, "assets", file), "utf8"))
      .join("");
    const { styles } = (await import(pathToFileURL(join(server, "server.js")).href)) as {
      styles: Record<string, string>;
    };
    const classes = [styles.root, styles.label];
    expect(classes).toEqual([scopedName("root", PROBE), scopedName("label", PROBE)]);
    for (const name of classes) expect(css).toContain(`.${name}{`);
  }, 60_000);

  test("scoped_names_unique", () => {
    // The hash is cut to 8 hex digits (32 bits); a collision would bleed one module's styles into another, silently.
    const seen = new Map<string, string>();
    for (const file of moduleFiles()) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const name of new Set([...text.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1] as string))) {
        const pair = `${relative(REPO_ROOT, file)}:${name}`;
        const scoped = scopedName(name, file);
        expect(seen.get(scoped) ?? pair, scoped).toBe(pair);
        seen.set(scoped, pair);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

/** Every *.module.css the builds or this test compile: under apps/, shared/ and this fixture folder. */
function moduleFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".module.css")) out.push(path);
    }
  };
  for (const top of ["apps", "shared", "scripts/ui/fixtures"]) walk(join(REPO_ROOT, top));
  return out;
}
