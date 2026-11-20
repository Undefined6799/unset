// What server.ts and the SvelteKit side share: settings and shutdown once per process, the log fields once per
// request. server.ts publishes it on globalThis before it imports the built handler, because importing the handler runs
// SvelteKit's init, which loads the hooks. This file has no side effects, so both sides can import it.
import type { AsyncLocalStorage } from "node:async_hooks";
import type { IdentityNetwork } from "@unset/domains-identity";
import type { CloseHook } from "@unset/shared-http";
import type { WebConfig } from "./config.ts";

/** Per request: the route the hook matched and the request id, for server.ts's log line. */
export type RequestNote = { route?: string; reqId: string };

/** What the SvelteKit side registers for shutdown: `draining` runs first (health answers 503), `close` after drain. */
export type Shutdown = { readonly draining: (() => void)[]; readonly close: CloseHook[] };

/**
 * What a test replaces: unmanaged dependencies only (rule TE-1), as interfaces/http's `StandIns`. `network` stands in
 * for PLC, DNS and handle domains; `fetch` for every request the OAuth client and the PDS calls make. Only a test entry
 * (tests/integration/web/stand-in-server.ts) sets them, before it imports server.ts; compose.ts refuses them outside
 * the test profile, so the shipped entry, which never sets them, always builds the real ones.
 */
export type StandIns = { readonly network?: IdentityNetwork; readonly fetch?: typeof globalThis.fetch };

export const STAND_INS_KEY = Symbol.for("unset.web.stand-ins");

export type ProcessNote = {
  readonly config: WebConfig;
  /**
   * The build's stylesheet path (`/_app/immutable/assets/….css`), for the gate's refusal page; absent, it is plain.
   * server.ts sets it once, after the handler has loaded and before it listens.
   */
  stylesheet?: string | undefined;
  readonly standIns?: StandIns;
  readonly requests: AsyncLocalStorage<RequestNote>;
  readonly shutdown: Shutdown;
};

export const NOTE_KEY = Symbol.for("unset.web");

export const publishedNote = (): ProcessNote | undefined =>
  (globalThis as Record<symbol, unknown>)[NOTE_KEY] as ProcessNote | undefined;
