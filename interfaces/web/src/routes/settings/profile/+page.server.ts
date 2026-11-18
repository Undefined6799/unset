// Settings › Profile (P2.13c). Until the profile editor lands (P2.21), the page says what will live here and that the
// profile stays private. The gate has already sent a signed-out visitor to /login (policy.ts).
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ setHeaders }) => {
  // FALLBACK until the gate sets these on every app page (asked of the integration lane): delete with it.
  setHeaders({ "cache-control": "private, no-store", vary: "Cookie" });
  // FALLBACK until locals carry the gate's privacyNotice (P1.20f): no notice is shown.
  return { privacyNotice: false };
};
