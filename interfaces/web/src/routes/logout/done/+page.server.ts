// GET /logout/done (ADR 0095 decision 5): where unset.cc's sign-out page sends the tab once chat is wiped. That
// navigation is cross-site, so it carries none of our Strict cookies, and /signed-out would lose the carried issuer
// (lib/server/sign-in-state.ts). This page reads and writes no state and moves on at once with a meta refresh: a new
// navigation whose client is this unset.sh document, so its site for cookies is unset.sh and the request is same-site
// (RFC 6265bis-22 section 5.2, criterion 2, and 5.2.1: a top-level document's site for cookies is the top-level
// origin; https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-22, read 2026-11-21). Chromium 156
// (Playwright 1.64.1) behaves so: tests/e2e/chat-page.chromium.spec.ts chat_page.unset_log_out and chat_page.strict_needs_the_bounce.
import type { ServerLoad } from "@sveltejs/kit";

export const load: ServerLoad = ({ setHeaders }) => {
  setHeaders({ "referrer-policy": "no-referrer" });
  return { shell: { kind: "site" } as const };
};
