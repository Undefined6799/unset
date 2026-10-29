// The signed-in account (P2.13) lives at /<DID>; /did and legacy /me resolve the caller's own destination.
// This is still an owner-only app page, not a public profile: the gate runs before the ownership check and
// handle verification. App pages are private, no-store and vary on Cookie (pageResponse, P1.22).
import { parseDid } from "@unset/domains-identity";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import { type AccountDeps, accountProps } from "./account-issuer.ts";

export function meRoutes(deps: AccountDeps): Route[] {
  const accountOf = accountProps(deps);

  return [
    ...["/did", "/me"].map((path) =>
      defineRoute({
        method: "GET",
        path,
        group: "app",
        rateLimit: "default",
        session: "handler",
        handler: async ({ request, deadline }) => {
          const opened = await deps.open(request, deadline, "/did");
          if (opened instanceof Response) return opened;
          // The session store keeps only DIDs this server wrote after the callback parsed them.
          return new Response(null, {
            status: 303,
            headers: { location: `/${opened.session.did}`, "cache-control": "private, no-store", vary: "Cookie" },
          });
        },
      }),
    ),
    defineRoute({
      method: "GET",
      path: "/:did",
      group: "app",
      rateLimit: "default",
      session: "handler",
      handler: async ({ request, params, deadline }) => {
        // shared/http decodes path parameters once; identity's parser accepts only supported DID syntax.
        const did = parseDid(params.did ?? "");
        if (did === null) throw new AppError("http.not_found");
        const accountPath = `/${did}`;
        const opened = await deps.open(request, deadline, accountPath);
        if (opened instanceof Response) return opened;
        if (did !== opened.session.did) throw new AppError("http.not_found");
        const { verdict, props } = await accountOf(opened, deadline);
        const body = deps.screens.me(props);
        return deps.page({
          group: "app",
          request,
          title: props.handle,
          body,
          // Islands on (the default): the menu drawer's theme picker hydrates so a choice leaves it open (P2.13e).
          shell: {
            noindex: true,
            navigation: {
              active: "account",
              accountPath,
              ...(verdict.status === "verified" ? { accountName: verdict.handle } : {}),
            },
          },
        });
      },
    }),
  ];
}
