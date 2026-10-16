// The appState a sign-in carries through the authorization server (P2.05 writes it, P2.06 reads it back). The library
// keeps it sealed and single-use in app.oauth_state and returns it at the callback; the server never sees it.
import type { Did } from "@unset/domains-identity";
import type { SafePath } from "@unset/shared-http";

export type AppState = {
  /** The P1.16 login nonce, also in this browser's `__Host-oauth_nonce` cookie. */
  readonly nonce: string;
  /** The account the form named, or null for the PDS chooser (any account on that server may come back). */
  readonly expectedDid: Did | null;
  readonly next: SafePath | null;
};

export function appStateOf(state: AppState): string {
  const { nonce, expectedDid, next } = state;
  return JSON.stringify({ v: 1, nonce, flow: "login", expectedDid, next, startedAt: Date.now() });
}
