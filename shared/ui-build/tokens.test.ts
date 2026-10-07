import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { runTokens, type TokensIo } from "./tokens.ts";

const UI = join(import.meta.dirname, "..", "ui");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A copy of shared/ui's token inputs and output, to break without touching the repository. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "tokens-"));
  temps.push(root);
  for (const dir of ["sheet", "fonts", "tokens", "src"]) cpSync(join(UI, dir), join(root, dir), { recursive: true });
  return root;
}
/** node:fs bound to one shared/ui root, as scripts/ui/tokens.ts binds it. */
const fileIo = (root: string): TokensIo => ({
  readText: (path) => readFileSync(join(root, path), "utf8"),
  sha256: (path) =>
    createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex"),
  writeText: (path, text) => writeFileSync(join(root, path), text),
});
const run = (root: string, args: string[]) => {
  const lines: string[] = [];
  return { code: runTokens(args, fileIo(root), (l) => lines.push(l)), lines };
};

test("tokens_generate_matches_committed", () => {
  const { code, lines } = run(UI, ["--check"]);
  expect(
    lines.filter((l) => l.startsWith("tokens.")),
    lines.join("\n"),
  ).toEqual([]);
  expect(code).toBe(0);
});

test("tokens_check_detects_stale_output", () => {
  const root = copy();
  writeFileSync(
    join(root, "src", "tokens.css"),
    `${readFileSync(join(root, "src", "tokens.css"), "utf8")}/* edited */\n`,
  );
  expect(run(root, ["--check"])).toMatchObject({
    code: 1,
    lines: expect.arrayContaining(["tokens.stale: src/tokens.css differs; run node scripts/ui/tokens.ts"]),
  });
  expect(run(root, []).code).toBe(0);
  expect(run(root, ["--check"]).code).toBe(0);
});

test("tokens_source_hash_mismatch", () => {
  const root = copy();
  const font = join(root, "fonts", "SpaceGrotesk-Variable.woff2");
  const bytes = readFileSync(font);
  bytes[100] = (bytes[100] ?? 0) ^ 1;
  writeFileSync(font, bytes);
  expect(run(root, ["--check"])).toMatchObject({
    code: 1,
    lines: expect.arrayContaining([
      expect.stringMatching(/^tokens\.source_mismatch: fonts\/SpaceGrotesk-Variable\.woff2/),
    ]),
  });
});

test("tokens_parse_error", () => {
  const root = copy();
  writeFileSync(join(root, "sheet", "tokens.json"), "{");
  expect(run(root, ["--check"]).lines).toEqual(expect.arrayContaining([expect.stringMatching(/^tokens\.parse: /)]));
});

test("tokens_prints_contrast_table", () => {
  const { lines } = run(UI, ["--check"]);
  expect(lines).toContain("| fg | bg | over | theme | ratio | min |");
  expect(
    lines.filter((l) => /^\| ink-muted \| surface-card \| emerald \| (dark|light) \| \d+\.\d\d \| 4\.5 \|$/.test(l)),
  ).toHaveLength(2);
});

test("fonts_budget", () => {
  const source = JSON.parse(readFileSync(join(UI, "sheet", "source.json"), "utf8"));
  const fonts = source.files.map((f: { path: string }) => f.path).filter((p: string) => p.endsWith(".woff2"));
  const bytes = fonts.reduce((sum: number, p: string) => sum + readFileSync(join(UI, p)).length, 0);
  expect(fonts).toHaveLength(2);
  expect(bytes).toBeLessThanOrEqual(122_880);
});
