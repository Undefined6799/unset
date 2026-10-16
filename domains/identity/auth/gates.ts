// Whether a signed-in account may pass the confirmed-email gate (P2.11; plan §5.3 "Email-verify gate"). Pure: the
// session store and the PDS call stay in the web server, because a domain does not import infrastructure.
export type EmailCache = { readonly confirmed: boolean | null; readonly checkedAt: Date | null };
export type EmailGate = "pass" | "refresh" | "verify";

/** `pass` uses the cache. `refresh` asks the PDS. `verify` sends the browser to `/verify-email` with no PDS call. */
export function emailGate(cache: EmailCache, nowMs: number, recheckS: number): EmailGate {
  if (cache.confirmed !== true) return "verify";
  if (cache.checkedAt === null) return "refresh";
  const ageS = (nowMs - cache.checkedAt.getTime()) / 1000;
  return ageS >= 0 && ageS <= recheckS ? "pass" : "refresh";
}

/**
 * The gate after a stale cache. A PDS outage keeps a previously confirmed member in (`transient`). A fresh `false`
 * sends them to confirm. Anything else is not a pass.
 */
export function verifiedAfterRefresh(answer: "transient" | "confirmed" | "unconfirmed"): "pass" | "verify" {
  return answer === "unconfirmed" ? "verify" : "pass";
}
