// Every colour class the chat page uses that names one of the theme's tokens (shared/ui/theme.css: bg-muted,
// text-primary-foreground, border-input/30, ...) resolves: Tailwind 4 makes such a class only for a colour that
// app.css's @theme maps (`--color-muted: var(--muted)`, as apps/web/app.css maps them; shadcn-svelte 1.8.1 manual setup,
// https://shadcn-svelte.com/docs/installation/manual). A token left unmapped yields no style and no error, as bg-muted
// did for the message bubbles.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const CHAT = import.meta.dirname;
const THEME = join(CHAT, "../../shared/ui/theme.css");
const NOT_COLOURS = /^(font|radius)/;
const COLOUR_CLASS =
  /(?<![\w-])(?:[a-z0-9[\]=-]+:)*(?:bg|text|border|ring|outline|fill|stroke|divide|caret|accent|decoration|placeholder)-([a-z-]+?)(?:\/\d+)?(?![\w-])/g;

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory()) return d.name === "node_modules" || d.name === "dist" ? [] : filesUnder(join(dir, d.name));
    return /\.(svelte|ts)$/.test(d.name) && !d.name.endsWith(".test.ts") ? [join(dir, d.name)] : [];
  });

test("chat.theme_maps_every_token_class: each theme colour a chat class names is mapped in app.css's @theme", () => {
  const tokens = new Set(
    [...readFileSync(THEME, "utf8").matchAll(/^\s*--([a-z-]+):/gm)]
      .map((m) => m[1] ?? "")
      .filter((t) => !NOT_COLOURS.test(t)),
  );
  const theme = readFileSync(join(CHAT, "app.css"), "utf8").match(/@theme inline \{([^}]*)\}/)?.[1] ?? "";
  const mapped = new Set([...theme.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]));
  const used = new Set(
    filesUnder(CHAT).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(COLOUR_CLASS)].map((m) => m[1] ?? "").filter((t) => tokens.has(t)),
    ),
  );
  expect(used.size).toBeGreaterThan(5);
  expect([...used].filter((t) => !mapped.has(t)).sort()).toEqual([]);
});
