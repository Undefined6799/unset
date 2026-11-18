// What server.ts and the SvelteKit side share: settings and shutdown once per process, the log fields once per
// request. server.ts publishes it on globalThis before it imports the built handler, because importing the handler runs
// SvelteKit's init, which loads the hooks. This file has no side effects, so both sides can import it.
import type { AsyncLocalStorage } from "node:async_hooks";
import type { CloseHook } from "@unset/shared-http";
import type { WebConfig } from "./config.ts";

/** Per request: the route the hook matched and the request id, for server.ts's log line. */
export type RequestNote = { route?: string; reqId: string };

/** What the SvelteKit side registers for shutdown: `draining` runs first (health answers 503), `close` after drain. */
export type Shutdown = { readonly draining: (() => void)[]; readonly close: CloseHook[] };

export type ProcessNote = {
  readonly config: WebConfig;
  readonly requests: AsyncLocalStorage<RequestNote>;
  readonly shutdown: Shutdown;
};

export const NOTE_KEY = Symbol.for("unset.web");

export const publishedNote = (): ProcessNote | undefined =>
  (globalThis as Record<symbol, unknown>)[NOTE_KEY] as ProcessNote | undefined;
