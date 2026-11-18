// What the settings pages tell the shell: the core shell with Settings current, the member's own profile link, the
// theme picker preset to the member's theme and returning to this page, and noindex (each load also sends
// X-Robots-Tag, as interfaces/http's page.ts does).
import { themeFromCookies, themeReturnTo } from "../../lib/server/theme.ts";
import type { ShellData } from "../../lib/shell.ts";

export const settingsShell = (locals: App.Locals, request: Request, path: string): ShellData => ({
  kind: "core",
  active: "settings",
  noindex: true,
  prefs: { theme: themeFromCookies(request.headers.get("cookie")), returnTo: themeReturnTo(path) },
  ...(locals.did === undefined ? {} : { account: { path: `/${locals.did}` } }),
});
