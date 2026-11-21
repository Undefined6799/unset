// The reason table (P2.27, ADR 0079): every icon is one the Icon component draws, and every link stays on this site.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { REASON_SCREENS, reasonScreen } from "./reasons.ts";

const ICONS = join(import.meta.dirname, "../../../../shared/ui/icons/icons.json");
const drawn = Object.keys((JSON.parse(readFileSync(ICONS, "utf8")) as { drawings: object }).drawings);

describe("notification reasons", () => {
  test("reasons.every_icon_is_drawn_and_every_link_is_a_site_path", () => {
    for (const screen of Object.values(REASON_SCREENS)) {
      expect(drawn).toContain(screen.icon);
      expect(screen.href).toMatch(/^\/[a-z]/);
    }
  });

  test("reasons.an_unknown_reason_has_no_row", () => {
    expect(reasonScreen("sign_in")?.title).toBe("New sign-in to your account");
    for (const unknown of ["chat", "toString", "__proto__", ""]) expect(reasonScreen(unknown)).toBeUndefined();
  });
});
