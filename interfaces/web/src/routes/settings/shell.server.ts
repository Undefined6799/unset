// What the settings pages tell the shell: the core shell with Settings current, the member's own profile link, and
// noindex (each load also sends X-Robots-Tag, as interfaces/http's page.ts does).
import type { ShellData } from "../../lib/shell.ts";

export const settingsShell = (locals: App.Locals): ShellData => ({
  kind: "core",
  active: "settings",
  noindex: true,
  ...(locals.did === undefined ? {} : { account: { path: `/${locals.did}` } }),
});
