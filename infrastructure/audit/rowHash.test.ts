// P1.15: the TS row hash against the vector P1.15m committed, which was computed independently with Python's hashlib
// and which audit.row_hash (SQL) also matches (tests/integration/postgres/audit.test.ts). It is read, never rewritten.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { rowHash, toMicros } from "./rowHash.ts";

const VECTOR = join(import.meta.dirname, "..", "..", "tests", "integration", "postgres", "audit-row-hash.vector.json");
const vector = JSON.parse(readFileSync(VECTOR, "utf8")) as Record<string, string | number>;
const text = (key: string): string => String(vector[key]);

describe("row hash", () => {
  test("row_hash_known_answer", () => {
    const hash = rowHash({
      lane: text("lane"),
      seq: BigInt(vector.seq ?? 0),
      tsMicros: toMicros(text("ts")),
      action: text("action"),
      writer: text("writer"),
      retentionClass: text("retentionClass"),
      prevHash: Buffer.from(text("prevHash"), "hex"),
      bodyMac: Buffer.from(text("bodyMac"), "hex"),
    });
    expect(Buffer.from(hash).toString("hex")).toBe(text("rowHash"));
  });

  test("to_micros_keeps_the_sixth_digit", () => {
    expect(toMicros("1970-01-01T00:00:00.000001Z")).toBe(1n);
    expect(toMicros("1969-12-31T23:59:59.999999Z")).toBe(-1n);
    expect(toMicros("2026-10-06T12:34:56Z")).toBe(1_791_290_096_000_000n);
    expect(() => toMicros("2026-10-06 12:34:56")).toThrow("audit.bad_timestamp");
  });
});
