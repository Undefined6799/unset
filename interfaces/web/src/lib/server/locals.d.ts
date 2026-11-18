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
      reqId: string;
      /** The request's deadline; every load and action passes it to each call it makes (rule RE-1). */
      deadline: AbortSignal;
    }
  }
}

export {};
