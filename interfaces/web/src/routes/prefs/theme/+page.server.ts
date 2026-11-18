// POST /prefs/theme (P1.22, P1.20g): a plain form sets the theme, with or without a session, and the browser goes back
// where it was. The gate has checked the method, the form type, the 2 KB body, the address limit and the Origin.
import { type Actions, error, redirect, type ServerLoad } from "@sveltejs/kit";
import { parseTheme, setThemeCookie, single, themeReturnTo } from "./theme.server.ts";

// Not a page: a GET answers as the Hono route did (405), not with a screen.
export const load: ServerLoad = () => error(405, "http.method_not_allowed");

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const theme = parseTheme(single(form, "theme"));
    if (theme === null) error(400, "prefs.invalid");
    setThemeCookie(cookies, theme);
    redirect(303, themeReturnTo(single(form, "return")));
  },
};
