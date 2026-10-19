// The test-only pages (P1.25c; step book record 2026-10-19-five-step-audit, P1.25c). compose.ts mounts them only when
// TEST_ROUTES is on, and the config refuses that in prod (config.ts), so production routing never holds them. They give
// the browser harness and the route tests a real 500, a real 503 and a real app-group page through the kit.
// The book names them `/__test/*`; the kit's path template refuses a leading underscore (shared/http/routes.ts
// SEGMENT, a trusted file), so they live under `/test-routes/`.
import { defineRoute, type ErrorPage, type Route } from "@unset/shared-http";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";

export const TEST_PATHS = {
  throw: "/test-routes/throw",
  unavailable: "/test-routes/unavailable",
  app: "/test-routes/app",
} as const;

export type TestRouteDeps = {
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  /** The kit's error-page hook as compose.ts builds it, so the 503 page is the error page every caller sees. */
  errorPage: ErrorPage;
};

const route = (path: string, group: "app" | "public", handler: Route["handler"]): Route =>
  defineRoute({ method: "GET", path, group, rateLimit: "default", session: "none", handler });

export const testRoutes = (deps: TestRouteDeps): Route[] => [
  // A plain throw: the kit logs it and answers 500 through the error-page hook, with its request id.
  route(TEST_PATHS.throw, "public", () => {
    throw new Error("test route throw");
  }),
  // No maintenance flag is booked, so this is the only 503 page: the kit's error page for service.unavailable, which
  // the kit's AppError path would send without Retry-After.
  route(
    TEST_PATHS.unavailable,
    "public",
    () =>
      new Response(deps.errorPage("service.unavailable", { group: "public" }), {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "retry-after": "30", "cache-control": "no-store" },
      }),
  ),
  route(TEST_PATHS.app, "app", ({ request }) =>
    deps.page({ group: "app", request, title: "Test page", body: deps.screens.home(), shell: {} }),
  ),
];
