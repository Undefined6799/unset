// Signing out of this browser (P2.08; plan §5.3 "Logout"). POST only, behind the CSRF gate, so neither a link nor
// another site can sign a member out. It ends this browser's session and marks the browser signed out, so the next
// sign-in asks the server for the password again. Other browsers of the same account keep their sessions, and the
// shared OAuth token set stays for them. No DID in any log line: only the count `auth.logout_this_browser`.
import type { Session } from "@unset/infrastructure-session";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route, type RouteGroup } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import type { ReactNode } from "react";
import { sessionClearCookie } from "../session-cookie.ts";
import type { WebRender } from "../web/render-entry.ts";
import { clearNonceCookie, clearTargetCookie, signedOutCookie } from "./sign-in-state.ts";

export type LogoutDeps = {
  /** This request's P2.03 session, or null. */
  readSession: (request: Request, deadline: AbortSignal) => Promise<Session | null>;
  /** P2.03 destroy, in its own transaction. */
  destroySession: (session: Session, deadline: AbortSignal) => Promise<void>;
  page: (page: { group: RouteGroup; request: Request; title: string; body: ReactNode }) => Response;
  screens: WebRender["screens"];
  pdsHost: string;
  log: Logger;
};

const FORM = "application/x-www-form-urlencoded";

export function logoutRoutes(deps: LogoutDeps): Route[] {
  return [
    defineRoute({
      method: "POST",
      path: "/logout",
      group: "app",
      accepts: [FORM],
      bodyLimit: 1024,
      rateLimit: "default",
      mutates: true,
      session: "none",
      handler: async ({ request, deadline }) => {
        const session = await deps.readSession(request, deadline);
        if (session !== null) {
          // A failed delete is a retryable 503 (book P2.08 step 3), and the cookie stays so the retry finds it.
          await deps.destroySession(session, deadline).catch((cause: unknown) => {
            throw new AppError("service.unavailable", { cause });
          });
          deps.log.info("auth.logout_this_browser");
        }
        const headers = new Headers({ location: "/signed-out", "cache-control": "no-store" });
        headers.append("set-cookie", sessionClearCookie());
        // A sign-in started before this one ends here too: its authorization was made without prompt=login.
        headers.append("set-cookie", clearNonceCookie());
        headers.append("set-cookie", clearTargetCookie());
        headers.append("set-cookie", signedOutCookie());
        return new Response(null, { status: 303, headers });
      },
    }),
    defineRoute({
      method: "GET",
      path: "/signed-out",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: async ({ request, deadline }) => {
        // A browser signed in again (Back after a new sign-in, a typed URL) is not told it is signed out.
        if ((await deps.readSession(request, deadline)) !== null) {
          return new Response(null, { status: 303, headers: { location: "/me", "cache-control": "no-store" } });
        }
        return deps.page({
          group: "app",
          request,
          title: "Signed out",
          body: deps.screens.signedOut({ pdsHost: deps.pdsHost }),
        });
      },
    }),
  ];
}
