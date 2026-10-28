// POST /prefs/theme (P1.22; plan §2 rule 4, §5.1): a plain form sets the theme with no client script. The kit has
// already checked the method, the media type, the 2 KB body limit and the CSRF gate (P1.04, P1.06, P1.07) before this
// handler reads anything. No session is needed in Phase 1 (there is none yet); the cookie is only read on app pages.
// The return target is checked by themeReturnTo (P2.13d), which also lets the sign-in pages return to themselves.
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import { single } from "../form-field.ts";
import { themeReturnTo } from "../prefs/return-to.ts";
import { parseTheme, themeCookie } from "../prefs/theme.ts";
import { redirect } from "../redirect.ts";

const FORM = "application/x-www-form-urlencoded";
const BODY_LIMIT_BYTES = 2048;

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
      // Thrown, so the kit renders the error through the web server's error page (P1.25k), not its own fixed page.
      if (theme === null) throw new AppError("prefs.invalid");
      return redirect(themeReturnTo(single(form, "return")), [themeCookie(theme)]);
    },
  }),
];
