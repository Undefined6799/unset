import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { appJsReport } from "./app-js.ts";

const KIB = 1024;
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A client directory whose _app/immutable holds JS files of about `kib` gzipped KiB each (random bytes do not shrink). */
function client(sizes: Record<string, number>): string {
  const root = mkdtempSync(join(tmpdir(), "app-js-budget-"));
  temps.push(root);
  for (const [file, kib] of Object.entries(sizes)) {
    const path = join(root, "_app", "immutable", file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, randomBytes(kib * KIB));
  }
  return root;
}

test("a_bundle_under_the_line_is_reported_without_a_warning", () => {
  const report = appJsReport(client({ "bundle.a.js": 50, "assets/x.css": 40 }), { warnGzipBytes: 120 * KIB });
  expect(report.warning).toBeUndefined();
  expect(report.lines).toHaveLength(2);
  expect(report.lines.at(-1)).toMatch(/^app page JS: 50\.\d KiB gzip \(warns above 120\.0 KiB\)$/);
});

test("a_bundle_over_the_line_warns", () => {
  const report = appJsReport(client({ "bundle.a.js": 100, "chunks/b.js": 30 }), { warnGzipBytes: 120 * KIB });
  expect(report.warning).toMatch(/^App page JS is 130\.\d KiB gzip, above the 120\.0 KiB target/);
});

test("an_empty_build_is_an_error_never_a_pass", () => {
  expect(() => appJsReport(client({}), { warnGzipBytes: 120 * KIB })).toThrow(/no \.js files/);
});

test("the_command_prints_an_annotation_and_still_exits_zero_when_over", () => {
  const dir = client({ "bundle.a.js": 130 });
  const out = execFileSync(process.execPath, [join(import.meta.dirname, "app-js.ts"), dir], { encoding: "utf8" });
  expect(out).toMatch(/^::warning title=App JS budget::App page JS is 130\.\d KiB gzip/m);
});
