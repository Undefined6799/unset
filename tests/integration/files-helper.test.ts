// tests/support/files.ts: the walk the object-store erasure test makes over the store's /data while the store keeps
// writing. A file the listing named and the store then renamed away (SeaweedFS's max_volume_id.tmp, main CI on
// a25d62a) is skipped; any other error still fails the walk.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeReadableScript, regularFilesHolding } from "../support/files.ts";

const NEEDLE = Buffer.from("needle");

function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), "files-helper-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "has.dat"), "a needle here");
  writeFileSync(join(dir, "none.dat"), "nothing");
  return dir;
}

test("finds_the_files_holding_the_needle", () => {
  const dir = tree();
  expect(regularFilesHolding(dir, NEEDLE)).toEqual([join(dir, "sub", "has.dat")]);
});

test("a_file_gone_since_the_listing_is_skipped", () => {
  const dir = tree();
  const listed = () => ["sub/has.dat", "sub/max_volume_id.tmp", "none.dat"];
  expect(regularFilesHolding(dir, NEEDLE, listed)).toEqual([join(dir, "sub", "has.dat")]);
});

test("any_other_error_still_fails", () => {
  const dir = tree();
  // A path under a regular file: stat fails with ENOTDIR, which is not a vanished file.
  expect(() => regularFilesHolding(dir, NEEDLE, () => ["none.dat/child"])).toThrow(/ENOTDIR/);
});

/** Runs makeReadableScript with a stand-in find that writes `stderr` and exits `code`. */
function runWithFind(stderr: string, code: number): { status: number | null; stderr: string } {
  const bin = mkdtempSync(join(tmpdir(), "files-helper-bin-"));
  const find = join(bin, "find");
  writeFileSync(find, `#!/bin/sh\nprintf '%s' '${stderr}' >&2\nexit ${code}\n`);
  chmodSync(find, 0o755);
  const run = spawnSync("sh", ["-c", makeReadableScript("/data")], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
  });
  return { status: run.status, stderr: run.stderr };
}

test("make_readable_passes_a_clean_walk", () => {
  expect(runWithFind("", 0).status).toBe(0);
});

test("make_readable_passes_files_gone_during_the_walk", () => {
  const gone =
    "find: /data/unset-private_3.vif.tmp.95791613: No such file or directory\n" +
    "chmod: /data/max_volume_id.tmp: No such file or directory\n";
  expect(runWithFind(gone, 1).status).toBe(0);
});

test("make_readable_fails_on_any_other_error", () => {
  const mixed = "chmod: /data/x.tmp: No such file or directory\nchmod: /data/1.dat: Operation not permitted\n";
  const run = runWithFind(mixed, 1);
  expect(run.status).toBe(1);
  expect(run.stderr).toContain("Operation not permitted");
});

test("make_readable_fails_a_silent_failure", () => {
  expect(runWithFind("", 1).status).toBe(1);
});
