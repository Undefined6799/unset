// verifyChain (P1.15): walks one lane in seq order and recomputes every link. `links` reads the chain only, which is
// all the auditor role can read (P3.22 runs it daily); `full` also checks each surviving body row's MAC, so it needs
// the owner's view (admin design 7.3's weekly run). A missing body row is fine: it was redacted (P1.15a).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuditLane } from "./actions.ts";
import type { AuditDb } from "./db.ts";
import { rowHash } from "./rowHash.ts";

export type ChainVerdict =
  | { readonly ok: true; readonly last: number }
  | { readonly ok: false; readonly badSeq: number; readonly reason: "link" | "hash" | "gap" | "body_mac" };

/** Where the walk starts: the first seq and its expected prev_hash (P1.15a passes the oldest segment's). */
export type ChainStart = { readonly seq: number; readonly prevHash: Uint8Array };

const BATCH = 5000;
const GENESIS: ChainStart = { seq: 1, prevHash: new Uint8Array(32) };
const COLUMNS =
  "c.seq::text AS seq, (EXTRACT(epoch FROM c.ts) * 1000000)::bigint::text AS ts_us, c.action, c.writer::text AS writer, " +
  "c.retention_class, c.body_mac, c.prev_hash, c.row_hash";
const LINKS = `SELECT ${COLUMNS} FROM audit.chain c WHERE c.lane = $1 AND c.seq >= $2 ORDER BY c.seq LIMIT ${BATCH}`;
const FULL =
  `SELECT ${COLUMNS}, b.k_body, b.body_text FROM audit.chain c ` +
  "LEFT JOIN audit.event_body b ON (b.lane, b.seq) = (c.lane, c.seq) " +
  `WHERE c.lane = $1 AND c.seq >= $2 ORDER BY c.seq LIMIT ${BATCH}`;

type Row = Record<string, unknown>;
const bytes = (value: unknown): Buffer => (Buffer.isBuffer(value) ? value : Buffer.alloc(0));
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && timingSafeEqual(a, b);

function bodyIntact(row: Row): boolean {
  if (row.body_text === null || row.body_text === undefined) return true;
  const mac = createHmac("sha256", bytes(row.k_body)).update(String(row.body_text), "utf8").digest();
  return same(mac, bytes(row.body_mac));
}

/** The first fault in one row, or null when it links to `prev` and its hash recomputes. */
function fault(lane: AuditLane, row: Row, expectedSeq: number, prev: Uint8Array, full: boolean): ChainVerdict | null {
  const seq = Number(row.seq);
  if (seq !== expectedSeq) return { ok: false, badSeq: seq, reason: "gap" };
  if (!same(bytes(row.prev_hash), prev)) return { ok: false, badSeq: seq, reason: "link" };
  const recomputed = rowHash({
    lane,
    seq: BigInt(String(row.seq)),
    tsMicros: BigInt(String(row.ts_us)),
    action: String(row.action),
    writer: String(row.writer),
    retentionClass: String(row.retention_class),
    prevHash: bytes(row.prev_hash),
    bodyMac: bytes(row.body_mac),
  });
  if (!same(recomputed, bytes(row.row_hash))) return { ok: false, badSeq: seq, reason: "hash" };
  if (full && !bodyIntact(row)) return { ok: false, badSeq: seq, reason: "body_mac" };
  return null;
}

export async function verifyChain(
  db: AuditDb,
  lane: AuditLane,
  mode: "links" | "full",
  from: ChainStart = GENESIS,
): Promise<ChainVerdict> {
  let next = from.seq;
  let prev: Uint8Array = from.prevHash;
  for (;;) {
    const { rows } = await db.query(mode === "full" ? FULL : LINKS, [lane, next]);
    for (const row of rows) {
      const bad = fault(lane, row, next, prev, mode === "full");
      if (bad !== null) return bad;
      prev = bytes(row.row_hash);
      next += 1;
    }
    if (rows.length < BATCH) return { ok: true, last: next - 1 };
  }
}
