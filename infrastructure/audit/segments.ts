// Sealed segments of the audit chain (P1.15a; migration 0017). Once a month of a lane is sealed, its segment row
// records the hash before its first row and the hash of its last, and those two are anchored off-box (P3.22). After
// an old segment's rows are dropped, the rest of the chain is verified from the dropped segment's head hash. Both
// functions read audit.segment and audit.chain only, which is all the auditor role can read.
import type { AuditLane } from "./actions.ts";
import type { AuditDb } from "./db.ts";
import type { ChainStart } from "./verify.ts";

export type SegmentVerdict = { readonly ok: true } | { readonly ok: false; readonly badSegment: number };

const NEWEST_DROPPED =
  "SELECT s.last_seq::text AS last_seq, s.head_hash FROM audit.segment s " +
  "WHERE s.lane = $1 AND s.dropped_at IS NOT NULL ORDER BY s.id DESC LIMIT 1";

/** A segment whose recorded hashes no longer match the chain rows at its two ends, oldest first. */
const MISMATCHED =
  "SELECT s.id FROM audit.segment s " +
  "LEFT JOIN audit.chain f ON f.lane = s.lane AND f.seq = s.first_seq " +
  "LEFT JOIN audit.chain l ON l.lane = s.lane AND l.seq = s.last_seq " +
  "WHERE s.lane = $1 AND s.dropped_at IS NULL " +
  "AND (f.prev_hash IS DISTINCT FROM s.prev_hash OR l.row_hash IS DISTINCT FROM s.head_hash) " +
  "ORDER BY s.id LIMIT 1";

/**
 * Where verifyChain starts for this lane: after the newest dropped segment, expecting its head hash as the first
 * remaining row's prev_hash. Undefined while nothing was dropped, so the walk starts at genesis.
 */
export async function chainStart(db: AuditDb, lane: AuditLane): Promise<ChainStart | undefined> {
  const { rows } = await db.query(NEWEST_DROPPED, [lane]);
  const row = rows[0];
  if (row === undefined || !Buffer.isBuffer(row.head_hash)) return undefined;
  return { seq: Number(row.last_seq) + 1, prevHash: row.head_hash };
}

/** Every sealed segment that still has its rows must match the chain at both ends; a missing end row is a mismatch. */
export async function verifySegments(db: AuditDb, lane: AuditLane): Promise<SegmentVerdict> {
  const { rows } = await db.query(MISMATCHED, [lane]);
  const bad = rows[0];
  return bad === undefined ? { ok: true } : { ok: false, badSegment: Number(bad.id) };
}
