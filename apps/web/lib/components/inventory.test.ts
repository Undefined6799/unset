// The component inventory (P1.20c; ADR 0055 points 1, 4 and 5): every shadcn-svelte component in ui/ is listed in
// inventory.json with each of its files, at the pinned registry version, and none appears unnoticed. A file's sha256
// pins its bytes; a file that differs from the registry's copy carries the registry's sha256 and the reason, so a
// change to a stock component is always recorded beside it. Icons come only through our Icon component. A folder of
// our own composites (ADR 0055: called out in the PR and listed) sits beside ui/ and icon/; it passes only when each of
// its files is listed under "ours", marked as ours, with its purpose, so it can never pass as stock.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import inventory from "./inventory.json" with { type: "json" };

type FileEntry = { sha256: string; registrySha256?: string; change?: string; origin?: string };
type OurEntry = { origin?: string; purpose?: string; sha256?: string };
const UI = join(import.meta.dirname, "ui");
// Read as data, not imported: the drawings the Svelte Icon renders, keyed by our icon names.
const ICONS = join(import.meta.dirname, "../../../../shared/ui/icons/icons.json");
const iconNames = Object.keys((JSON.parse(readFileSync(ICONS, "utf8")) as { drawings: object }).drawings);
const components = inventory.components as Record<string, Record<string, FileEntry>>;
const ours = inventory.ours as Record<string, Record<string, OurEntry>>;
/** Folders beside ui/ that are neither ui/ nor the Icon: each must be one of ours. */
const OWN_FOLDERS = new Set(["icon", "ui"]);
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const folders = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

describe("component inventory", () => {
  test("inventory_lists_every_component_folder_and_no_other", () => {
    expect(folders(UI)).toEqual(Object.keys(components).sort());
    expect(folders(import.meta.dirname)).toEqual(expect.arrayContaining([...OWN_FOLDERS]));
    const rest = folders(import.meta.dirname).filter((name) => !OWN_FOLDERS.has(name));
    expect(rest, "a folder of our own composites must be listed under ours").toEqual(Object.keys(ours).sort());
  });

  test.each(Object.entries(ours))("our_folder_%s_lists_each_file_as_ours", (name, files) => {
    expect(OWN_FOLDERS.has(name) || name in components, `${name} shadows a stock or Icon folder`).toBe(false);
    expect(readdirSync(join(import.meta.dirname, name)).sort()).toEqual(Object.keys(files).sort());
    for (const [file, entry] of Object.entries(files)) {
      expect(entry.origin, `${name}/${file} origin`).toBe("ours");
      expect(entry.purpose?.length ?? 0, `${name}/${file} purpose`).toBeGreaterThan(20);
      // Ours, not stock: no registry pin to hide behind.
      expect(entry.sha256, `${name}/${file} sha256`).toBeUndefined();
    }
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
      expect(entry.origin, `${name}/${file} is stock`).toBeUndefined();
    }
  });

  test("components_draw_icons_only_through_our_icon", () => {
    const dirs = [
      ...Object.keys(components).map((name) => join(UI, name)),
      ...Object.keys(ours).map((name) => join(import.meta.dirname, name)),
    ];
    for (const dir of dirs)
      for (const file of readdirSync(dir)) {
        const name = dir.slice(import.meta.dirname.length + 1);
        const source = readFileSync(join(dir, file), "utf8");
        expect(source, `${name}/${file}`).not.toMatch(/@lucide|lucide-svelte|@tabler|phosphor|<svg\b/);
        for (const [, icon] of source.matchAll(/<Icon\b[^>]*\bname="([^"]+)"/g))
          expect(iconNames, `${name}/${file}`).toContain(icon);
      }
  });
});
