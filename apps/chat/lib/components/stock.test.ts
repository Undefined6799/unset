// The chat page's components are stock (ADR 0099 decision 5; ADR 0055): each file under ui/, and utils.ts, is byte for
// byte apps/web's copy, which apps/web/lib/components/inventory.json pins to the shadcn-svelte 1.8.1 registry; and
// icon/ is web's Icon (decision 33), drawing only the pinned Iconoir data. So a change to one here is caught, and the
// two apps can never drift apart unnoticed.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const CHAT = join(import.meta.dirname, "..");
const WEB = join(import.meta.dirname, "../../../web/lib");
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)],
  );

test("chat_components_are_web_stock_copies", () => {
  const icon = ["icon.svelte", "index.ts"].map((name) => join(CHAT, "components/icon", name));
  const files = [join(CHAT, "utils.ts"), ...filesUnder(join(CHAT, "components/ui")), ...icon];
  expect(files.length).toBeGreaterThan(8);
  for (const file of files) {
    const path = relative(CHAT, file);
    expect(readFileSync(file).equals(readFileSync(join(WEB, path))), path).toBe(true);
  }
});
