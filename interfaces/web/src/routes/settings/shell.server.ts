// What the settings pages tell the shell: the core shell with Settings current, the theme picker preset to the
// member's theme and returning to this page, the wide main so the side list sits on the left as the member page's
// side column does, and noindex (each load also sends X-Robots-Tag, as interfaces/http's page.ts does). The member's
// own profile link and handle come from the root layout (+layout.server.ts), as on every page.
import { themeFromCookies, themeReturnTo } from "../../lib/server/theme.ts";
import type { ShellData } from "../../lib/shell.ts";

export const settingsShell = (request: Request, path: string): ShellData => ({
  kind: "core",
  active: "settings",
  noindex: true,
  wide: true,
  prefs: { theme: themeFromCookies(request.headers.get("cookie")), returnTo: themeReturnTo(path) },
});
