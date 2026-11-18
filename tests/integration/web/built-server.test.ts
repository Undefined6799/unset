// The build the web tests and the browser harness share (outside review of f5cab2f, finding 2): an edit to a file the
// build is made from gives a new fingerprint, so the next run builds again instead of reusing older code, and an
// unchanged tree keeps it, so the two harness servers and the files of one run share one build. Run on a folder of
// its own, so no other test file's build sees the edits.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { sourceFingerprint } from "./built-server.ts";

const root = mkdtempSync(join(tmpdir(), "unset-fingerprint-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("an_edit_to_a_build_input_changes_the_fingerprint_and_outputs_do_not", () => {
  const page = join(root, "src", "routes", "+page.svelte");
  mkdirSync(join(root, "src", "routes"), { recursive: true });
  writeFileSync(page, "<p>one</p>\n");
  const before = sourceFingerprint([root]);
  expect(sourceFingerprint([root])).toBe(before);

  for (const output of ["build", "node_modules", ".svelte-kit", "dist"]) {
    mkdirSync(join(root, output), { recursive: true });
    writeFileSync(join(root, output, "x.js"), "x\n");
  }
  expect(sourceFingerprint([root])).toBe(before);

  writeFileSync(page, "<p>two</p>\n");
  utimesSync(page, new Date(), new Date(Date.now() + 60_000));
  expect(sourceFingerprint([root])).not.toBe(before);
});
