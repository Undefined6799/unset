import { mkdirSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { readLines } from "@unset/shared-admin-envelope";
import { expect, test } from "vitest";
import { openRequestLog, verifyLog } from "../../../interfaces/pds-admin/log.ts";
import { tempDir } from "./harness.ts";

test("log.failed_append_no_gap: an append that fails leaves the chain whole for the next one", () => {
  const file = join(tempDir(), "log.jsonl");
  const log = openRequestLog(file, Buffer.alloc(32, 1));
  log.append({ outcome: "denied", reason: "json" }, Date.now());
  // A directory where the file was makes the next append fail before writing a byte.
  renameSync(file, `${file}.away`);
  mkdirSync(file);
  expect(() => log.append({ outcome: "denied", reason: "json" }, Date.now())).toThrow();
  rmdirSync(file);
  renameSync(`${file}.away`, file);
  log.append({ outcome: "denied", reason: "json" }, Date.now());
  const lines = readLines(file);
  expect(lines.map((line) => JSON.parse(line).seq)).toEqual([1, 2]);
  expect(verifyLog(lines)).toBeNull();
});
