// The chat page's own words for where it stands (ADR 0088 decision 3). Screens see only these; the adapter in
// matrix/ turns the SDK's objects into them, so no SDK type reaches a screen (architecture instructions §4-5).
import type { Conversations } from "./conversations.ts";

/** What the door handed this page at redeem (ADR 0081 decision 4). Held in this page's memory only, never stored. */
export type ChatSession = {
  readonly accessToken: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly expiresAtMs: number;
  /** The 32-byte lock key of this browser's local key store (ADR 0083 decision 4). */
  readonly storageKey: Uint8Array;
  /** The door made this device for this browser just now: whatever the browser kept for the account is from an ended
   * device and is wiped before the store opens (ADR 0083 decision 5). */
  readonly newDevice: boolean;
};

/** What an unlock with a typed key came to (ADR 0083 decision 3): a wrong key is said plainly and asked again. */
export type UnlockOutcome = "unlocked" | "wrong_key" | "unfinished" | "failed";

/**
 * - signing_in: the hop, the redeem, or the client's first sync is under way.
 * - setting_up: the account's keys are being made or stored (ADR 0089); nothing else is reachable.
 * - save_key: the new recovery key, to save and check; `save` stores it once the check has passed.
 * - setup_elsewhere: another browser of the account is setting up right now.
 * - locked: encryption runs, but this browser cannot read history yet; `unlock` tries a typed recovery key.
 * - ready: this browser is cross-signed and can read history; `conversations` is what the screens use (step 9).
 * - logging_out: Log out runs: the key backup catches up, then the door ends this device (ADR 0083 decision 5).
 * - logged_out: the device is ended and this account's stores are gone from this browser.
 * - signed_out: the server no longer takes the token.
 * - error: a fixed catalog code, never a message from elsewhere.
 */
export type ChatState =
  | { readonly kind: "signing_in" }
  | { readonly kind: "setting_up" }
  | { readonly kind: "save_key"; readonly key: string; readonly save: () => void }
  | { readonly kind: "setup_elsewhere" }
  | {
      readonly kind: "locked";
      readonly unlock: (typed: string) => Promise<UnlockOutcome>;
      readonly logOut: () => void;
    }
  | {
      readonly kind: "ready";
      readonly conversations: Conversations;
      /** A chat partner's public name, or null to show the handle alone (core/public-name.ts, ADR 0096). */
      readonly names: (chatId: string) => Promise<string | null>;
      readonly me: string;
      readonly logOut: () => void;
    }
  | { readonly kind: "logging_out" }
  | { readonly kind: "logged_out" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "error"; readonly code: string };
