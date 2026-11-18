// Issuing one invite (P2.09 steps 8 to 12; ADR 0060 decision 4), after the envelope has passed. In order: sign-ups
// open, the inviter is ours and in good standing, both quotas hold, the PDS creates the code. Every step's outcome is
// an answer for the handler; nothing here throws for an expected failure.
import { type Pds, PdsUnavailable } from "./pds.ts";
import { accountQuota, globalQuota } from "./quota.ts";

export type IssueLimits = {
  readonly signupsOpen: boolean;
  readonly windowMs: number;
  readonly maxPerWindow: number;
  readonly maxPerDayGlobal: number;
};

export type IssueResult =
  | { readonly kind: "issued"; readonly code: string; readonly remaining: number; readonly availableAt: number | null }
  | { readonly kind: "closed" }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "quota"; readonly reason: string; readonly availableAt: number }
  | { readonly kind: "unavailable"; readonly reason: string };

/** The PDS's code shape: our hostname with dots as dashes, then two base32 groups (server/util.ts, genInvCode). */
const CODE = /^[A-Za-z0-9-]{1,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Standing = { kind: "ok"; createdAt: number[] } | Exclude<IssueResult, { kind: "issued" }>;

/** Step 9: the inviter is hosted here, active, confirmed, allowed to invite and not taken down. */
async function standing(pds: Pds, did: string): Promise<Standing> {
  const info = await pds.getAccountInfo(did);
  if (info.status === 400 && isRecord(info.body) && info.body.error === "NotFound") {
    return { kind: "denied", reason: "not_hosted" };
  }
  if (info.status !== 200 || !isRecord(info.body)) return { kind: "unavailable", reason: "account_info" };
  const account = info.body;
  if (account.deactivatedAt !== undefined) return { kind: "denied", reason: "deactivated" };
  if (account.invitesDisabled === true) return { kind: "denied", reason: "invites_disabled" };
  if (typeof account.emailConfirmedAt !== "string") return { kind: "denied", reason: "email_unconfirmed" };
  const status = await pds.getSubjectStatus(did);
  if (status.status !== 200 || !isRecord(status.body)) return { kind: "unavailable", reason: "subject_status" };
  const takedown = status.body.takedown;
  if (isRecord(takedown) && takedown.applied === true) return { kind: "denied", reason: "taken_down" };
  const invites = Array.isArray(account.invites) ? account.invites : [];
  const createdAt = invites
    .map((invite) => (isRecord(invite) && typeof invite.createdAt === "string" ? Date.parse(invite.createdAt) : NaN))
    .filter((at) => !Number.isNaN(at));
  return { kind: "ok", createdAt };
}

/** How issuing reads and spends the daily cap: the count so far, and a durable reservation made before the PDS call. */
export type DailyCap = { readonly reservedToday: () => number; readonly reserve: () => void };

/** Steps 8 to 11 for one inviter. The daily slot is reserved before the PDS call and stays spent even if it fails. */
export async function issueInvite(
  pds: Pds,
  limits: IssueLimits,
  did: string,
  daily: DailyCap,
  now: () => number,
): Promise<IssueResult> {
  if (!limits.signupsOpen) return { kind: "closed" };
  try {
    const inviter = await standing(pds, did);
    if (inviter.kind !== "ok") return inviter;
    const account = accountQuota(inviter.createdAt, now(), limits.windowMs, limits.maxPerWindow);
    if (!account.ok) return { kind: "quota", reason: "account", availableAt: account.availableAt };
    const global = globalQuota(daily.reservedToday(), now(), limits.maxPerDayGlobal);
    if (!global.ok) return { kind: "quota", reason: "global", availableAt: global.availableAt };
    daily.reserve();
    const created = await pds.createInviteCode(did);
    const code = isRecord(created.body) ? created.body.code : undefined;
    if (created.status !== 200 || typeof code !== "string" || !CODE.test(code)) {
      return { kind: "unavailable", reason: "create" };
    }
    return { kind: "issued", code, remaining: account.remaining, availableAt: account.availableAt };
  } catch (error) {
    if (error instanceof PdsUnavailable) return { kind: "unavailable", reason: `pds_${error.message}` };
    throw error;
  }
}
