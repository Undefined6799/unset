// The audit's closed lists in TS (P1.15), mirroring the seeds in infrastructure/postgres/migrations/0009_audit_tables.sql.
// tests/integration/audit/chain.test.ts (reason_union_matches_table) fails when either side changes alone. A new
// action or reason is a migration plus a line here.

/** Every action and the lane it is chained in. The lane follows from the action; no caller chooses it. */
export const AUDIT_ACTIONS = {
  "mod.delist": "mod",
  "mod.undelist": "mod",
  "mod.takedown": "mod",
  "mod.reinstate": "mod",
  "mod.sessions_ended": "mod",
  "pii.email_reveal": "mod",
  "hold.created": "mod",
  "hold.executed": "mod",
  "mod.decision": "mod",
  "report.submitted": "sec",
  "age_gate.blocked": "sec",
  "index.account_state": "sec",
  "account.erased": "sec",
  "pii.review_play": "mod",
  "csam.suspected": "mod",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export type AuditLane = (typeof AUDIT_ACTIONS)[AuditAction];

/** admin design 7.4's codes, plus those P2.12, the Arachnid classification and P3.07 pass. */
export const AUDIT_REASONS = [
  "spam",
  "impersonation",
  "illegal_content",
  "harassment",
  "legal_order",
  "user_request_gdpr",
  "security_incident",
  "support_request",
  "csam",
  "underage",
  "age_gate_hosted",
  "harmful-abusive-material",
  "account_deleted",
  "moderator_foreign",
  "user_request",
  "legal_hold_closed",
] as const;

export type AuditReason = (typeof AUDIT_REASONS)[number];

/** `unknown` is for a call whose result never came back, such as a PDS call that timed out (admin design 7.2). */
export const AUDIT_OUTCOMES = ["attempted", "succeeded", "failed", "denied", "unknown"] as const;

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
