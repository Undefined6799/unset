// The header's account button shows the member's initial from the root layout's account (+layout.server.ts,
// shellAccount). A page whose shell passes its own `account` replaces that one, so an account with a path and no name
// drew the generic person icon, as if signed out (staging break test 2026-11-21: /notifications, /notifications/sign-ins
// and /invite). A page leaves `account` to the layout, or names the member too.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROUTES = join(import.meta.dirname, "..", "routes");
/** A shell's account written with a path and no name, as `account: { path: ... }`. */
const NAMELESS = /account:\s*\{\s*path:[^}]*\}/g;

test("no page's shell replaces the layout's account with one that has no name", () => {
  const nameless: string[] = [];
  for (const file of readdirSync(ROUTES, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".server.ts") || file.endsWith(".test.ts")) continue;
    for (const match of readFileSync(join(ROUTES, file), "utf8").matchAll(NAMELESS)) {
      if (!match[0].includes("name")) nameless.push(file);
    }
  }
  expect(nameless).toEqual([]);
});
