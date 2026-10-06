import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { configGlueLines, countGlueLines, FREE_DECLARATIVE_LINES } from "./count-glue-lines.ts";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "glue-"));
  temps.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

test("count_glue_lines_rule", () => {
  const root = tree({
    "glue/a.ts": ["// header", "", "export const a = 1;", "/* block", "   comment */", "export const b = 2;"].join(
      "\n",
    ),
    "glue/nested/b.tsx": ["export function B() {", "  return <div />; // tail", "}", ""].join("\n"),
    "glue/a.test.ts": "export const ignored = 1;\nexport const alsoIgnored = 2;\n",
    "glue/notes.md": "not code\n",
  });
  expect(countGlueLines(join(root, "glue"))).toBe(5);
});

test("glue_count_includes_config_plugin", () => {
  const plugin = Array.from({ length: 28 }, (_, i) => `    const v${i} = ${i};`);
  const source = [
    'import { defineConfig } from "vite";',
    "",
    "function plugin() {",
    ...plugin,
    "}",
    "",
    "export default defineConfig({ plugins: [plugin()] });",
  ].join("\n");
  // 30 function lines (header, 28 body lines, closing brace) plus 2 declarative lines inside the free allowance.
  expect(configGlueLines("vite.config.ts", source)).toBe(30);
});

test("config_declarative_lines_beyond_allowance_count", () => {
  const options = Array.from({ length: FREE_DECLARATIVE_LINES + 5 }, (_, i) => `  option${i}: ${i},`);
  const source = ["export default {", ...options, "};"].join("\n");
  expect(configGlueLines("vite.config.ts", source)).toBe(7);
});

test("config_arrow_callbacks_count_as_functions", () => {
  const source = [
    "export default {",
    "  css: {",
    "    modules: {",
    "      generateScopedName: (name: string, file: string) =>",
    "        name + file.length,",
    "    },",
    "  },",
    "};",
  ].join("\n");
  expect(configGlueLines("vite.config.ts", source)).toBe(2);
});

test("count_adds_config_files", () => {
  const root = tree({ "glue/a.ts": "export const a = 1;\n", "vite.config.ts": "export default { f: () => 1 };\n" });
  expect(countGlueLines(join(root, "glue"), [join(root, "vite.config.ts")])).toBe(2);
});
