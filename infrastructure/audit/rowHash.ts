// The chain's row hash in TS (P1.15), byte for byte the same as audit.row_hash in
// infrastructure/postgres/migrations/0008_audit.sql:
//   sha256("unset.audit.v1" || 0x00 || lp(lane) || u64be(seq) || i64be(ts in microseconds since the Unix epoch) ||
//          lp(action) || lp(writer) || lp(retention_class) || prev_hash || body_mac)
// where lp(x) is the 2-byte big-endian byte length of x's UTF-8 bytes, then those bytes. Both sides are pinned to
// tests/integration/postgres/audit-row-hash.vector.json, computed independently with Python's hashlib.
import { createHash } from "node:crypto";
import { AuditError } from "./error.ts";

export type ChainRow = {
  readonly lane: string;
  readonly seq: bigint;
  readonly tsMicros: bigint;
  readonly action: string;
  readonly writer: string;
  readonly retentionClass: string;
  readonly prevHash: Uint8Array;
  readonly bodyMac: Uint8Array;
};

const DOMAIN = Buffer.from("unset.audit.v1\u0000", "utf8");

function lp(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function int64(value: bigint, signed: boolean): Buffer {
  const out = Buffer.alloc(8);
  if (signed) out.writeBigInt64BE(value);
  else out.writeBigUInt64BE(value);
  return out;
}

export function rowHash(row: ChainRow): Uint8Array {
  return createHash("sha256")
    .update(DOMAIN)
    .update(lp(row.lane))
    .update(int64(row.seq, false))
    .update(int64(row.tsMicros, true))
    .update(lp(row.action))
    .update(lp(row.writer))
    .update(lp(row.retentionClass))
    .update(row.prevHash)
    .update(row.bodyMac)
    .digest();
}

const ISO_UTC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;

/** An ISO 8601 UTC time with up to six fractional digits, as microseconds since the Unix epoch. */
export function toMicros(iso: string): bigint {
  const match = ISO_UTC.exec(iso);
  const ms = match ? Date.parse(`${match[1]}Z`) : Number.NaN;
  if (!match || Number.isNaN(ms)) throw new AuditError("audit.bad_timestamp");
  return BigInt(ms) * 1000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
