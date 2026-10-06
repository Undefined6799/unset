// POST /prefs/theme (P1.22; plan §2 rule 4, §5.1): a plain form sets the theme with no client script. The kit has
// already checked the method, the media type, the 2 KB body limit and the CSRF gate (P1.04, P1.06, P1.07) before this
// handler reads anything. No session is needed in Phase 1 (there is none yet); the cookie is only read on app pages.
import { defineRoute, errorResponse, type Route, safeReturnPath } from "@unset/shared-http";
import { parseTheme, themeCookie } from "../prefs/theme.ts";

const FORM = "application/x-www-form-urlencoded";
const BODY_LIMIT_BYTES = 2048;

/** The one value of `name` in the form, or null when it is missing or repeated. */
function single(form: URLSearchParams, name: string): string | null {
  const values = form.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

export const prefsRoutes = (): Route[] => [
  defineRoute({
    method: "POST",
    path: "/prefs/theme",
    group: "app",
    accepts: [FORM],
    bodyLimit: BODY_LIMIT_BYTES,
    rateLimit: "default",
    mutates: true,
    session: "none",
    handler: async ({ request }) => {
      const form = new URLSearchParams(await request.text());
      const theme = parseTheme(single(form, "theme"));
      if (theme === null) return errorResponse("prefs.invalid", "app");
      const location = safeReturnPath(single(form, "return")) ?? "/";
      return new Response(null, {
        status: 303,
        headers: { location, "cache-control": "no-store", "set-cookie": themeCookie(theme) },
      });
    },
  }),
];
