// The chat page parses in every browser it serves: no regular expression literal uses the `v` flag (ES2024), which
// Safari before 17 cannot parse (MDN browser-compat-data, javascript/builtins/RegExp.json unicodeSets: safari 17,
// safari_ios mirrors it, read 2026-11-21), so one such literal stops the whole page loading there. vite.config.ts
// builds for es2024, the edition that added the flag, so the build keeps such a literal as written; the check is on
// the source. The `u` flag's \p{...} escapes (ES2018) need no `v`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROOT = import.meta.dirname;
/** A regular expression literal and its flags: a `/` not after a value, a body with classes and escapes, a `/`. */
const LITERAL = /(?<![\w)\]$])\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/([dgimsuyv]+)(?!\w)/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("chat.regex_no_v_flag: no regular expression literal in the page uses the v flag", () => {
  const found = sources(ROOT).flatMap((file) =>
    Array.from(readFileSync(file, "utf8").matchAll(LITERAL))
      .filter((m) => m[1]?.includes("v"))
      .map((m) => `${relative(ROOT, file)}: ${m[0]}`),
  );
  expect(found).toEqual([]);
});
