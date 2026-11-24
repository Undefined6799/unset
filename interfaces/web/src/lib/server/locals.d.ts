// What the request gate (hooks.server.ts) puts on every request: SvelteKit's App.Locals (kit 3.2.0 types, `Locals`).
// Here, not in src/app.d.ts, because it names domain types, which only server code may import (svelte-screens-no-core).
import type { Did } from "@unset/domains-identity";

declare global {
  namespace App {
    interface Locals {
      /** The signed-in DID; undefined for a visitor. */
      did: Did | undefined;
      /**
       * The sign-in server's origin the session row carries (ADR 0048), re-checked as a bare https origin on a DNS
       * name: a string to link, null when the stored value no longer passes (hide the link, never read another), and
       * undefined for a visitor or a session made before the column (then `services().issuerOf` reads the token set).
       */
      issuerOrigin: string | null | undefined;
      /**
       * The one-time privacy banner (P2.12): true when the app gate let a member through whose accepted privacy
       * version is older than this build's. False for a visitor and on pages the gate does not run.
       */
      privacyNotice: boolean;
      reqId: string;
      /**
       * True once SvelteKit reported an error for this request (hooks.server.ts handleError), which is when it draws
       * the error page in place of the route's own. The gate reads it to choose the document's CSP (ADR 0116 point 3).
       */
      erred: boolean;
      /** The request's deadline; every load and action passes it to each call it makes (rule RE-1). */
      deadline: AbortSignal;
      /** When `deadline` fires, on the `performance.now()` clock: what a PDS call context needs (infrastructure/pds pds-call.ts, P2.07a). */
      deadlineAt: number;
    }
  }
}
