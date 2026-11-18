// Settings › Profile (P2.13c). Until the profile editor lands (P2.21), the page says what will live here and that the
// profile stays private. The gate has already sent a signed-out visitor to /login (policy.ts) and set the app page's
// private, no-store and Vary: Cookie.
import type { ServerLoad } from "@sveltejs/kit";
import { settingsShell } from "../shell.server.ts";

export const load: ServerLoad = ({ locals, setHeaders }) => {
  setHeaders({ "x-robots-tag": "noindex" });
  return {
    shell: settingsShell(locals),
    // FALLBACK until locals carry the gate's privacyNotice (P1.20f): no notice is shown.
    privacyNotice: false,
  };
};
