// Each generated drawing module equals its entry in icons.json and is deeply frozen (P1.24b). Moved out of the icon
// build's tests (P1.25h) because it reads and imports only shared/ui's own files.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const HERE = import.meta.dirname;

test("icon_drawing_modules_match_icons_json", async () => {
  const json = JSON.parse(readFileSync(join(HERE, "icons.json"), "utf8"));
  const names = Object.keys(json.drawings).sort();
  expect(readdirSync(join(HERE, "drawings")).sort()).toEqual(names.map((n) => `${n}.generated.ts`));
  for (const name of names) {
    const drawing = (await import(`./drawings/${name}.generated.ts`)).default;
    expect(drawing, name).toEqual(json.drawings[name]);
    expect(Object.isFrozen(drawing) && drawing.every(Object.isFrozen), name).toBe(true);
  }
});
