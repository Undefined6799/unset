// web's side of invite issuing (P2.09 "Algorithm (web side)"; ADR 0060 decisions 3 and 7): sign one envelope for the
// member, post it to pds-admin through net-guard's pds-admin policy, and map the answer to a result. A fresh `jti` per
// call, so a retry after `unavailable` is a new request.

import type { KeyObject } from "node:crypto";
import { randomBytes } from "node:crypto";
import type { Did } from "@unset/domains-identity";
import { type NetGuard, NetGuardError, pdsAdmin } from "@unset/infrastructure-net-guard";
import { type AdminPayload, signEnvelope } from "@unset/shared-admin-envelope";

export type InviteIssuerSettings = {
  /** PDS_ADMIN_URL: pds-admin's internal origin. */
  readonly origin: string;
  readonly env: "dev" | "prod";
  readonly pdsDid: string;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
};

export type IssueInviteResult =
  | { readonly kind: "ok"; readonly code: string; readonly remaining: number; readonly availableAt: string | null }
  | { readonly kind: "quota"; readonly availableAt: string | null }
  | { readonly kind: "closed" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

const LIFETIME = 60;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parse(body: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Maps pds-admin's status and body to a result; any shape it does not expect is `unavailable`. */
function resultOf(status: number, body: Record<string, unknown> | null): IssueInviteResult {
  const availableAt = typeof body?.availableAt === "string" ? body.availableAt : null;
  if (status === 200) {
    const { code, remaining } = body ?? {};
    const okAt = body?.availableAt === null || typeof body?.availableAt === "string";
    if (typeof code === "string" && Number.isSafeInteger(remaining) && (remaining as number) >= 0 && okAt) {
      return { kind: "ok", code, remaining: remaining as number, availableAt };
    }
    return { kind: "unavailable" };
  }
  if (status === 429) return { kind: "quota", availableAt };
  if (status === 409) return { kind: "closed" };
  if (status === 403) return { kind: "denied" };
  return { kind: "unavailable" };
}

/** `issueInvite(inviter)`: one code for the signed-in member, issued for themselves only. */
export function createInviteIssuer(guard: NetGuard, settings: InviteIssuerSettings, now = () => Date.now()) {
  const policy = pdsAdmin(settings.origin);
  return async (inviter: Did): Promise<IssueInviteResult> => {
    const iat = Math.floor(now() / 1000);
    const payload: AdminPayload = {
      v: 1,
      env: settings.env,
      aud: "pds-admin",
      pds_did: settings.pdsDid,
      verb: "invite.issue",
      target: inviter,
      actor_did: inviter,
      jti: randomBytes(16).toString("base64url"),
      iat,
      exp: iat + LIFETIME,
    };
    const body = new TextEncoder().encode(JSON.stringify(signEnvelope(payload, settings.key)));
    try {
      const res = await guard.request(policy, {
        url: `${settings.origin}/v1/invite.issue`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        timeoutMs: 8_000,
        maxBytes: 4_096,
      });
      return resultOf(res.status, parse(res.body));
    } catch (error) {
      if (error instanceof NetGuardError) return { kind: "unavailable" };
      throw error;
    }
  };
}
