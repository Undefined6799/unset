// The OAuth scope strings (P1.31, plan §3 "Granular permissions + permission sets", narrowed by ADR 0039). Our own
// collections come from the permission set; what a set may not hold (blob, account) is requested beside it.
// Syntax: atproto.com/specs/permission and @atproto/oauth-scopes 0.5.13, dist/scopes/include-scope.js.
import authApp from "../schemas/sh.unset.authApp.json" with { type: "json" };

/**
 * Scopes requested beside the permission set: an image upload for the avatar and banner, and the e-mail address. ADR
 * 0039: only what a shipped feature uses. Bluesky writes and reads, video upload and reports join with their features.
 */
const OUTSIDE_THE_SET = ["blob:image/*", "account:email?action=read"];

type Permission = { resource: string; collection?: string[]; action?: string[] };

/** The full scope: our permission set by reference, then the scopes it cannot hold. */
export function scopeString(): string {
  return ["atproto", `include:${authApp.id}`, ...OUTSIDE_THE_SET].join(" ");
}

/**
 * The same grant for a PDS without permission sets: each permission of the set written as a granular scope. An
 * unresolvable set fails authorization with invalid_scope and the server does not fall back, so the client retries
 * with this (@atproto/oauth-provider, request/request-manager.ts:293-310).
 */
export function scopeStringFallback(): string {
  return ["atproto", ...authApp.defs.main.permissions.flatMap(granular), ...OUTSIDE_THE_SET].join(" ");
}

function granular(permission: Permission): string[] {
  // An rpc entry inherits its audience from the include: scope, which a granular scope cannot express. None exists
  // yet; the first one decides its fallback form instead of guessing here.
  if (permission.resource !== "repo") throw new Error(`no fallback form for a ${permission.resource} permission`);
  const actions = (permission.action ?? []).map((action) => `action=${action}`).join("&");
  return (permission.collection ?? []).map((collection) => `repo:${collection}${actions ? `?${actions}` : ""}`);
}
