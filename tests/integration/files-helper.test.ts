// tests/support/files.ts: the walk the object-store erasure test makes over the store's /data while the store keeps
// writing. A file the listing named and the store then renamed away (SeaweedFS's max_volume_id.tmp, main CI on
// a25d62a) is skipped; any other error still fails the walk.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { regularFilesHolding } from "../support/files.ts";

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
