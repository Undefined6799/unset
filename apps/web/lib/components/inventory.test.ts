// The component inventory (P1.20c; ADR 0055 points 1, 4 and 5): every shadcn-svelte component in ui/ is listed in
// inventory.json with each of its files, at the pinned registry version, and none appears unnoticed. A file's sha256
// pins its bytes; a file that differs from the registry's copy carries the registry's sha256 and the reason, so a
// change to a stock component is always recorded beside it. Icons come only through our Icon component.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import inventory from "./inventory.json" with { type: "json" };

type FileEntry = { sha256: string; registrySha256?: string; change?: string };
const UI = join(import.meta.dirname, "ui");
// Read as data, not imported: the drawings the Svelte Icon renders, keyed by our icon names.
const ICONS = join(import.meta.dirname, "../../../../shared/ui/icons/icons.json");
const iconNames = Object.keys((JSON.parse(readFileSync(ICONS, "utf8")) as { drawings: object }).drawings);
const components = inventory.components as Record<string, Record<string, FileEntry>>;
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const folders = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

describe("component inventory", () => {
  test("inventory_lists_every_component_folder_and_no_other", () => {
    expect(folders(UI)).toEqual(Object.keys(components).sort());
    expect(folders(import.meta.dirname)).toEqual(["icon", "ui"]);
  });

  test("inventory_pins_the_registry_version", () => {
    expect(inventory.registry).toBe("shadcn-svelte@1.8.1");
    expect(sha256(join(import.meta.dirname, "..", "utils.ts"))).toBe(inventory.utils.sha256);
  });

  test.each(Object.entries(components))("component_%s_files_are_listed_and_pinned", (name, files) => {
    const dir = join(UI, name);
    expect(readdirSync(dir).sort()).toEqual(Object.keys(files).sort());
    for (const [file, entry] of Object.entries(files)) {
      expect(sha256(join(dir, file)), `${name}/${file}`).toBe(entry.sha256);
      // Stock unless recorded: a changed file names the registry's bytes and says why.
      if (entry.registrySha256 !== undefined) {
        expect(entry.registrySha256).not.toBe(entry.sha256);
        expect(entry.change?.length ?? 0, `${name}/${file} change`).toBeGreaterThan(20);
      } else expect(entry.change).toBeUndefined();
    }
  });

  test("components_draw_icons_only_through_our_icon", () => {
    for (const name of Object.keys(components))
      for (const file of readdirSync(join(UI, name))) {
        const source = readFileSync(join(UI, name, file), "utf8");
        expect(source, `${name}/${file}`).not.toMatch(/@lucide|lucide-svelte|@tabler|phosphor|<svg\b/);
        for (const [, icon] of source.matchAll(/<Icon\b[^>]*\bname="([^"]+)"/g))
          expect(iconNames, `${name}/${file}`).toContain(icon);
      }
  });
});
