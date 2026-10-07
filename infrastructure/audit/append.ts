// appendAudit (P1.15): the only TS way into the audit, through audit.append (0008). Every field is checked here first,
// so free text never reaches the database, and audit.append checks it again (book P1.15, algorithm step 2). The
// writer is the database role of the caller's connection, stamped by audit.append; actorDid and actorKey are what the
// calling process asserts about the human.
import { type Did, parseDid } from "@unset/domains-identity";
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_REASONS,
  type AuditAction,
  type AuditLane,
  type AuditOutcome,
  type AuditReason,
} from "./actions.ts";
import type { AuditDb } from "./db.ts";
import { AuditError } from "./error.ts";

export type AuditEvent = {
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly actorDid?: Did;
  /** A WebAuthn credential id (base64url). */
  readonly actorKey?: string;
  readonly target?: Did;
  readonly reason?: AuditReason;
  readonly case?: string;
  /** The admin action's JWT id: 22 base64url characters, never the token. */
  readonly jti?: string;
  readonly requestId?: string;
  /** A 32-byte hash of the receipt, never the receipt. */
  readonly receipt?: Uint8Array;
};

const JTI = /^[A-Za-z0-9_-]{22}$/;
/** 0008's bound: base64url of WebAuthn's 1023-byte credential id cap is at most 1366 characters. */
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,1366}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const optional = (value: unknown, valid: (value: unknown) => boolean): boolean => value === undefined || valid(value);
const isText = (pattern: RegExp) => (value: unknown) => typeof value === "string" && pattern.test(value);
const isDid = (value: unknown) => typeof value === "string" && parseDid(value) === value;
const isOneOf = (list: readonly string[]) => (value: unknown) => typeof value === "string" && list.includes(value);

/** The event's fields re-checked at run time, since a cast can carry any string into a typed field. */
function isValid(event: AuditEvent): boolean {
  return (
    Object.hasOwn(AUDIT_ACTIONS, event.action) &&
    isOneOf(AUDIT_OUTCOMES)(event.outcome) &&
    optional(event.actorDid, isDid) &&
    optional(event.actorKey, isText(CREDENTIAL_ID)) &&
    optional(event.target, isDid) &&
    optional(event.reason, isOneOf(AUDIT_REASONS)) &&
    optional(event.case, isText(UUID)) &&
    optional(event.jti, isText(JTI)) &&
    optional(event.requestId, isText(UUID)) &&
    optional(event.receipt, (value) => value instanceof Uint8Array && value.length === 32)
  );
}

/** Appends one event in the caller's transaction. Any failure throws, and the caller must not act. */
export async function appendAudit(tx: AuditDb, event: AuditEvent): Promise<{ lane: AuditLane; seq: number }> {
  if (!isValid(event)) throw new AuditError("audit.bad_input");
  const { rows } = await tx.query(
    "SELECT lane, seq::text AS seq FROM audit.append($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [
      event.action,
      event.outcome,
      event.actorDid ?? null,
      event.actorKey ?? null,
      event.target ?? null,
      event.reason ?? null,
      event.case ?? null,
      event.jti ?? null,
      event.requestId ?? null,
      event.receipt === undefined ? null : Buffer.from(event.receipt),
    ],
  );
  return { lane: AUDIT_ACTIONS[event.action], seq: Number(rows[0]?.seq) };
}
