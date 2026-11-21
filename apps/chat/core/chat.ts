// The chat page's own words for where it stands (ADR 0088 decision 3). Screens see only these; the adapter in
// matrix/ turns the SDK's objects into them, so no SDK type reaches a screen (architecture instructions §4-5).

/** What the door handed this page at redeem (ADR 0081 decision 4). Held in this page's memory only, never stored. */
export type ChatSession = {
  readonly accessToken: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly expiresAtMs: number;
  /** The 32-byte lock key of this browser's local key store (ADR 0083 decision 4). */
  readonly storageKey: Uint8Array;
};

/** What an unlock with a typed key came to (ADR 0083 decision 3): a wrong key is said plainly and asked again. */
export type UnlockOutcome = "unlocked" | "wrong_key" | "unfinished" | "failed";

/**
 * - signing_in: the hop, the redeem, or the client's first sync is under way.
 * - locked: encryption runs, but this browser cannot read history yet (not cross-signed by the account).
 * - ready: this browser is cross-signed and can read history.
 * - signed_out: the server no longer takes the token.
 * - error: a fixed catalog code, never a message from elsewhere.
 */
export type ChatState =
  | { readonly kind: "signing_in" }
  | { readonly kind: "locked" }
  | { readonly kind: "ready" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "error"; readonly code: string };
