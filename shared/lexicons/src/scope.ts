// The OAuth scope strings (P1.31, plan §3 "Granular permissions + permission sets"). Our own collections come from
// the permission set; what a set may not hold (foreign NSIDs, blob, account, Bluesky reads) is requested beside it.
// Syntax: atproto.com/specs/permission and @atproto/oauth-scopes 0.5.13, dist/scopes/include-scope.js.
import authApp from "../schemas/sh.unset.authApp.json" with { type: "json" };

const BSKY_APPVIEW = "did:web:api.bsky.app#bsky_appview";
const BSKY_READS = ["getFeed", "getTimeline", "getPosts", "getFeedGenerators", "getPostThread"];

/** Scopes requested beside the permission set, in plan §3's order. */
const OUTSIDE_THE_SET = [
  "repo:app.bsky.feed.like?action=create&action=delete",
  "repo:app.bsky.feed.post",
  "repo:app.bsky.graph.follow",
  "repo:app.bsky.actor.profile",
  "blob:image/*",
  "blob:video/*",
  "account:email?action=read",
  ...BSKY_READS.map((method) => `rpc:app.bsky.feed.${method}?aud=${BSKY_APPVIEW}`),
  // Reports reach our own Ozone in Phase 5, whose DID does not exist yet (step-book answer 36).
  "rpc:com.atproto.moderation.createReport?aud=*",
];

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
