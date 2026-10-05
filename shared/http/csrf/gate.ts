// The CSRF gate (P1.07; plan §2 rule 14, §5.1, §6.1): every request other than GET and HEAD passes it, and only a
// same-origin request gets through. It decides by Sec-Fetch-Site, then an exact Origin, then an exact Referer, and
// denies everything else, including its own failure. Hono's `csrf` is not used: it lets JSON requests through.
// Sec-Fetch-Site first, as Go 1.25's CrossOriginProtection does; ours also denies a request that carries no signal.

export type CsrfReason =
  | "sfs_cross_site"
  | "sfs_same_site"
  | "origin_mismatch"
  | "origin_null"
  | "referer_mismatch"
  | "no_signal"
  | "error";
export type CsrfDecision = { ok: true } | { ok: false; reason: CsrfReason };

const deny = (reason: CsrfReason): CsrfDecision => ({ ok: false, reason });
const ALLOW: CsrfDecision = { ok: true };

/** Steps 2–5 over the request's headers. A header that is absent is `null`, as `Headers.get` returns it. */
function decideHeaders(headers: Pick<Headers, "get">, publicOrigin: string): CsrfDecision {
  // Step 2: Sec-Fetch-Site, when the browser sends one we can act on. `same-site` covers chat.unset.sh and
  // admin.int.unset.sh, which are never trusted (plan §2 rule 14).
  const site = headers.get("sec-fetch-site")?.toLowerCase();
  if (site === "same-origin") return ALLOW;
  if (site === "cross-site") return deny("sfs_cross_site");
  if (site === "same-site") return deny("sfs_same_site");
  // Step 3: an exact Origin. No suffix, wildcard or site match, no default-port folding, and no Referer fallback.
  const origin = headers.get("origin");
  if (origin !== null) {
    if (origin === "null") return deny("origin_null");
    return origin.toLowerCase() === publicOrigin ? ALLOW : deny("origin_mismatch");
  }
  // Step 4: with no Origin, the Referer's origin, exactly.
  const referer = headers.get("referer");
  if (referer !== null) {
    let refererOrigin: string;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      return deny("referer_mismatch");
    }
    return refererOrigin === publicOrigin ? ALLOW : deny("referer_mismatch");
  }
  // Step 5: no signal at all.
  return deny("no_signal");
}

/**
 * The gate for one public origin (`PUBLIC_ORIGIN`). Its decision for a GET or HEAD is allow: the kit never installs it
 * there, and GET handlers cannot mutate (`defineRoute`, `GET_MUTATION_EXCEPTIONS`).
 */
export function createCsrfGate(publicOrigin: string): (request: Pick<Request, "method" | "headers">) => CsrfDecision {
  const expected = new URL(publicOrigin).origin;
  return (request) => {
    try {
      if (request.method === "GET" || request.method === "HEAD") return ALLOW;
      return decideHeaders(request.headers, expected);
    } catch {
      return deny("error"); // step 6: the gate's own failure denies (OWASP Top 10 2025 A10)
    }
  };
}
