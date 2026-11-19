// Member invites (book P2.10 "Algorithm (POST /invite)"; plan §5.3 "Login and signup"): a signed-in member asks for one
// sign-up code for our PDS. pds-admin issues it (P2.09, ADR 0060), with its own quotas; this rule makes one form
// submission one request and one stored row (plan §2 rule 12a, rule DA-2), whatever the browser sends twice. The
// ports are I/O only (rule AB-2): the interface wires Postgres, the pds-admin client and the audit store to them.
import type { Did } from "./syntax.ts";

declare const submissionBrand: unique symbol;
/** The id the invite form carries, one per render: a lowercase v4 UUID. */
export type SubmissionId = string & { readonly [submissionBrand]: true };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseSubmissionId(raw: string | null): SubmissionId | null {
  return raw !== null && UUID_V4.test(raw) ? (raw as SubmissionId) : null;
}

declare const inviteBrand: unique symbol;
/** One stored invite's id, a v4 UUID the store made; a form names it to hide the row. */
export type InviteId = string & { readonly [inviteBrand]: true };

export function parseInviteId(raw: string | null): InviteId | null {
  return raw !== null && UUID_V4.test(raw) ? (raw as InviteId) : null;
}

/**
 * The code an invite link carries, if it is one we would show: letters, digits and dashes, at most 64. Never checked
 * against the PDS (that needs admin power); the PDS's sign-up form checks it.
 */
export function joinCode(raw: string | null): string | null {
  return raw !== null && /^[A-Za-z0-9-]{1,64}$/.test(raw) ? raw : null;
}

/** What claiming a submission found: a new pending row, or the row an earlier send of the same form left. */
export type InviteClaim =
  | { readonly kind: "claimed"; readonly id: InviteId }
  | { readonly kind: "issued" }
  | { readonly kind: "pending" };

/** pds-admin's answer (infrastructure/pds admin-invite.ts maps its statuses to these). */
export type InviteIssue =
  | { readonly kind: "ok"; readonly code: string; readonly remaining: number; readonly availableAt: string | null }
  | { readonly kind: "quota"; readonly availableAt: string | null }
  | { readonly kind: "closed" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

export type InvitePorts = {
  /** Inserts a pending row for the submission, committed before any request, or reports the row already there. */
  readonly claim: (did: Did, submission: SubmissionId) => Promise<InviteClaim>;
  readonly issue: (did: Did) => Promise<InviteIssue>;
  /** Seals the code onto the caller's pending row `id`. */
  readonly store: (did: Did, id: InviteId, code: string) => Promise<void>;
  /** Deletes the caller's pending row `id`, so the same form can be sent again. */
  readonly drop: (did: Did, id: InviteId) => Promise<void>;
  /** The security audit row for a member pds-admin refused. */
  readonly denied: (did: Did) => Promise<void>;
};

export type InviteRefusal =
  | "invite.in_progress"
  | "invite.quota"
  | "invite.closed"
  | "invite.denied"
  | "invite.unavailable";

export type InviteOutcome =
  /** `remaining` is null when an earlier send of the form issued the code. */
  | { readonly kind: "issued"; readonly remaining: number | null }
  | { readonly kind: "refused"; readonly code: InviteRefusal; readonly availableAt?: string }
  /** The code exists on the PDS but could not be stored; the member's quota absorbs it (book P2.10, accepted). */
  | { readonly kind: "store_failed" };

const REFUSAL: Record<Exclude<InviteIssue["kind"], "ok">, InviteRefusal> = {
  quota: "invite.quota",
  closed: "invite.closed",
  denied: "invite.denied",
  unavailable: "invite.unavailable",
};

/**
 * One invite for `did`. Any answer other than a code deletes the pending row first, so the form can be sent again; an
 * `unavailable` after a lost reply may still have issued a code, which the quota absorbs as for `store_failed`.
 */
export async function issueMemberInvite(
  ports: InvitePorts,
  did: Did,
  submission: SubmissionId,
): Promise<InviteOutcome> {
  const claim = await ports.claim(did, submission);
  if (claim.kind === "issued") return { kind: "issued", remaining: null };
  if (claim.kind === "pending") return { kind: "refused", code: "invite.in_progress" };
  const answer = await ports.issue(did);
  if (answer.kind === "ok") {
    try {
      await ports.store(did, claim.id, answer.code);
    } catch {
      return { kind: "store_failed" };
    }
    return { kind: "issued", remaining: answer.remaining };
  }
  await ports.drop(did, claim.id);
  if (answer.kind === "denied") await ports.denied(did);
  const refused = { kind: "refused", code: REFUSAL[answer.kind] } as const;
  return answer.kind === "quota" && answer.availableAt !== null
    ? { ...refused, availableAt: answer.availableAt }
    : refused;
}
