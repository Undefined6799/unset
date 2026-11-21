// The request log (P2.09 Outputs; ADR 0060 decision 5): one fsynced line per request outcome, each hashing the one
// before it. It never holds a code, a raw DID or the password: DIDs and codes are HMACs under the log key, which keeps
// lines linkable for an investigation and leaves nothing for eraseDid to reach. A PDS code has only ~50 bits
// (@atproto/pds 0.5.51 src/api/com/atproto/server/util.ts, getRandomToken), so a bare hash of it could be brute-forced.
import { createHash, createHmac } from "node:crypto";
import { appendLine, canonicalize, readLines } from "@unset/shared-admin-envelope";
import { utcMidnight } from "./quota.ts";

/** `reserved` is written, fsynced, before the PDS call and is what the daily cap counts, so a crash after the PDS
 * created a code can never leave that code uncounted. `issued` follows when the code is back. */
export type Outcome = "reserved" | "issued" | "denied" | "error";

/** What a caller records; the log adds `seq`, `ts`, `prev` and `hash`, and turns DIDs and the code into MACs. */
export type LogFields = {
  readonly outcome: Outcome;
  readonly reason?: string;
  readonly verb?: string;
  readonly kid?: string;
  readonly jti?: string;
  readonly actorDid?: string;
  readonly targetDid?: string;
  readonly code?: string;
};

export type RequestLog = {
  readonly append: (fields: LogFields, now: number) => void;
  /** Codes this service reserved (and so may have created) since `now`'s UTC midnight. */
  readonly reservedToday: (now: number) => number;
};

const GENESIS = "0".repeat(64);
type Entry = Record<string, string | number>;

const hashOf = (prev: string, entry: Entry): string =>
  createHash("sha256").update(prev).update(canonicalize(entry)).digest("hex");

export function openRequestLog(file: string, logKey: Buffer): RequestLog {
  const lines = readLines(file);
  const last = lines.length > 0 ? (JSON.parse(lines[lines.length - 1] as string) as Entry) : undefined;
  let seq = typeof last?.seq === "number" ? last.seq : 0;
  let prev = typeof last?.hash === "string" ? last.hash : GENESIS;
  const reserved = lines
    .map((line) => JSON.parse(line) as Entry)
    .filter((entry) => entry.outcome === "reserved")
    .map((entry) => Date.parse(String(entry.ts)));
  const mac = (value: string): string => createHmac("sha256", logKey).update(value).digest("hex");

  return {
    append: (fields, now) => {
      // seq and prev move only after the line is on disk, so a failed append leaves no gap in the chain.
      const next = seq + 1;
      const entry: Entry = { seq: next, ts: new Date(now).toISOString(), outcome: fields.outcome, prev };
      if (fields.reason !== undefined) entry.reason = fields.reason;
      if (fields.verb !== undefined) entry.verb = fields.verb;
      if (fields.kid !== undefined) entry.kid = fields.kid;
      if (fields.jti !== undefined) entry.jti = fields.jti;
      if (fields.actorDid !== undefined) entry.actorMac = mac(fields.actorDid);
      if (fields.targetDid !== undefined) entry.targetMac = mac(fields.targetDid);
      if (fields.code !== undefined) entry.codeMac = mac(fields.code);
      const hash = hashOf(prev, entry);
      appendLine(file, JSON.stringify({ ...entry, hash }));
      seq = next;
      prev = hash;
      if (fields.outcome === "reserved") reserved.push(now);
    },
    reservedToday: (now) => reserved.filter((at) => at >= utcMidnight(now)).length,
  };
}

/** Checks the chain: the first `seq` whose `prev` or `hash` does not match, or null when every line holds. */
export function verifyLog(lines: readonly string[]): number | null {
  let prev = GENESIS;
  for (const [index, line] of lines.entries()) {
    let parsed: Entry;
    try {
      parsed = JSON.parse(line) as Entry;
    } catch {
      return index + 1;
    }
    const { hash, ...entry } = parsed;
    if (entry.prev !== prev || entry.seq !== index + 1 || hash !== hashOf(prev, entry)) return index + 1;
    prev = String(hash);
  }
  return null;
}
