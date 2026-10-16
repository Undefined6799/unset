// The scopes the OAuth client declares and the grant a sign-in needs (P2.04; plan §3). The request strings are P1.31's:
// `scopeString()` names our permission set, `scopeStringFallback()` writes it out for a server without permission sets.
// The client metadata must list every scope either may request, so it declares their union. Coverage is decided by
// the pinned @atproto/oauth-scopes 0.5.13 matcher (`ScopePermissions`), never by comparing strings.
import { ScopePermissions } from "@atproto/oauth-scopes";
import { IMAGE_ACCEPT, NSID, scopeString, scopeStringFallback } from "@unset/shared-lexicons";

/** Every scope the client may request, once each, in request order. */
export const SCOPE_METADATA = [...new Set([...scopeString().split(" "), ...scopeStringFallback().split(" ")])].join(
  " ",
);

type Requirement = { readonly scope: string; readonly granted: (permissions: ScopePermissions) => boolean };
const repoWrite = (collection: string): Requirement[] =>
  (["create", "update", "delete"] as const).map((action) => ({
    scope: `repo:${collection}?action=${action}`,
    granted: (permissions) => permissions.allowsRepo({ collection, action }),
  }));

/** The least a grant must hold to start a session: write our own records, upload an image, read the e-mail address. */
const REQUIRED_GRANT: readonly Requirement[] = [
  { scope: "atproto", granted: (permissions) => permissions.scopes.has("atproto") },
  ...repoWrite(NSID.profile),
  ...repoWrite(NSID.section),
  // Every image type the app accepts: a server may narrow the wildcard to one type (review on #921).
  { scope: "blob:image/*", granted: (permissions) => IMAGE_ACCEPT.every((mime) => permissions.allowsBlob({ mime })) },
  {
    scope: "account:email?action=read",
    granted: (permissions) => permissions.allowsAccount({ attr: "email", action: "read" }),
  },
];

/** The permissions our own set grants, written out; an `include:` of any other set grants nothing here. */
const OUR_SET = scopeStringFallback()
  .split(" ")
  .filter((token) => token.startsWith("repo:sh.unset."));

/**
 * Whether `granted` (the token response's scope) holds REQUIRED_GRANT. A server may return our set as its `include:`
 * token or already expanded; the include form is read as the set's own permissions.
 */
export function grantCovers(granted: string): { ok: true } | { ok: false; missing: string[] } {
  const tokens = granted.split(" ").filter((token) => token !== "");
  const expanded = tokens.flatMap((token) => (token === `include:${NSID.authApp}` ? OUR_SET : [token]));
  const permissions = new ScopePermissions(expanded);
  const missing = REQUIRED_GRANT.filter((requirement) => !requirement.granted(permissions)).map((r) => r.scope);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
