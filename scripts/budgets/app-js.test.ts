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

type Fake = { start: string[]; nodes: string[][]; routes: { id: string; layouts: number[]; leaf: number }[] };

/**
 * A build directory shaped as kit 3.2.0 writes it under the split strategy: build/server/manifest.js with the start
 * files and each route's nodes, build/server/nodes/<n>.js with each node's imports, and the files under build/client,
 * each `kib` gzipped KiB of random bytes (which do not shrink) named `<kib>k-<name>.js`.
 */
function build({ start, nodes, routes }: Fake): string {
  const root = mkdtempSync(join(tmpdir(), "app-js-budget-"));
  temps.push(root);
  const quoted = (files: string[]) => JSON.stringify(files.map((file) => `_app/immutable/${file}`));
  const routeText = routes
    .map(
      (r) =>
        `\t\t{\n\t\t\tid: "${r.id}",\n\t\t\tpattern: /^x$/,\n\t\t\tparams: [],\n\t\t\tpage: { layouts: [${r.layouts.join(",")},], errors: [1,], leaf: ${r.leaf} },\n\t\t\tendpoint: null\n\t\t}`,
    )
    .join(",\n");
  mkdirSync(join(root, "server", "nodes"), { recursive: true });
  writeFileSync(
    join(root, "server", "manifest.js"),
    `return {\n\tclient: {start:"x",app:"y",imports:${quoted(start)},stylesheets:[],fonts:[]},\n\troutes: [\n${routeText}\n\t]\n}`,
  );
  nodes.forEach((files, n) => {
    writeFileSync(join(root, "server", "nodes", `${n}.js`), `export const imports = ${quoted(files)};\n`);
  });
  for (const file of new Set([...start, ...nodes.flat()])) {
    const path = join(root, "client", "_app", "immutable", file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, randomBytes(Number(/(\d+)k-/.exec(file)?.[1] ?? 0) * KIB));
  }
  return root;
}

const TWO_PAGES: Fake = {
  start: ["entry/30k-start.js", "chunks/20k-core.js"],
  nodes: [["nodes/10k-0.js", "chunks/20k-core.js"], [], ["nodes/5k-2.js"], ["nodes/60k-3.js", "chunks/30k-editor.js"]],
  routes: [
    { id: "/settings", layouts: [0], leaf: 2 },
    { id: "/[did=did]", layouts: [0], leaf: 3 },
  ],
};

test("each_route_counts_its_own_pieces_and_the_shared_ones_once", () => {
  const report = appJsReport(build(TWO_PAGES), { warnGzipBytes: 160 * KIB });
  expect(report.warning).toBeUndefined();
  // Heaviest first: start 30 + core 20 (counted once) + layout 10 + page 60 + editor 30.
  expect(report.lines[0]).toMatch(/^ {2}\/\[did=did\]: 150\.\d KiB gzip in 5 files$/);
  expect(report.lines[1]).toMatch(/^ {2}\/settings: 65\.\d KiB gzip in 4 files$/);
  expect(report.lines.at(-1)).toMatch(/^app page JS: 150\.\d KiB gzip on \/\[did=did\] \(warns above 160\.0 KiB\)$/);
});

test("the_heaviest_route_over_the_line_warns", () => {
  const report = appJsReport(build(TWO_PAGES), { warnGzipBytes: 120 * KIB });
  expect(report.warning).toMatch(/^App page JS is 150\.\d KiB gzip on \/\[did=did\], above the 120\.0 KiB target/);
});

test("a_missing_server_build_is_an_error_never_a_pass", () => {
  const root = mkdtempSync(join(tmpdir(), "app-js-budget-"));
  temps.push(root);
  expect(() => appJsReport(root, { warnGzipBytes: 120 * KIB })).toThrow(/manifest\.js/);
  const empty = build({ start: ["entry/1k-start.js"], nodes: [], routes: [] });
  expect(() => appJsReport(empty, { warnGzipBytes: 120 * KIB })).toThrow(/no page routes/);
});

test("the_command_prints_an_annotation_and_still_exits_zero_when_over", () => {
  const dir = build(TWO_PAGES);
  const out = execFileSync(process.execPath, [join(import.meta.dirname, "app-js.ts"), dir], { encoding: "utf8" });
  expect(out).toMatch(/^::warning title=App JS budget::App page JS is 150\.\d KiB gzip on \/\[did=did\]/m);
});
