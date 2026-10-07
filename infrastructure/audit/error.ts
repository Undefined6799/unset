// The one audit failure type the TS side raises (P1.15). The database's own refusals (UA001 to UA005) reach the caller
// as they are, and either kind means the caller's transaction rolls back and the action does not happen (admin design
// 7.2: a failed `attempted` write means stop).

export type AuditCode = "audit.bad_input" | "audit.bad_timestamp";

/** A refused append or an unreadable chain row. Carries the code only, never the field's value. */
export class AuditError extends Error {
  readonly code: AuditCode;

  constructor(code: AuditCode) {
    super(code);
    this.name = "AuditError";
    this.code = code;
  }
}
