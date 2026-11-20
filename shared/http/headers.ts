// The security headers every web response carries besides its CSP (P1.08; plan §2 rule 15, §6.1). The web process
// sets them on every response, error pages and build files included (interfaces/web/server.ts); the CSP itself is
// the web's own (interfaces/web/src/lib/server/csp.ts).

export type HeaderSet = Readonly<Record<string, string>>;

const PERMISSIONS =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()";

export const SECURITY_HEADERS: HeaderSet = Object.freeze({
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-frame-options": "DENY",
  "permissions-policy": PERMISSIONS,
  "strict-transport-security": "max-age=63072000; includeSubDomains",
});
