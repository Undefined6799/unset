// Guard (P1.20k; ADR 0055 point 2): every colour in the Svelte UI comes from shared/ui/theme.css through Tailwind's
// theme classes (bg-background, text-muted-foreground, ...). Biome's CSS rules (noHexColors, token-only.grit) read
// .css files only, so a colour written into a class as an arbitrary value (`bg-[#fff]`, `text-[rgb(...)]`,
// `[color:red]`) would pass them. This guard refuses one in the .svelte and .ts files of the web UI: the components
// in apps/web/lib and the routes in interfaces/web/src. Lexical on purpose: a hex or colour function anywhere inside
// `[...]` counts, so `shadow-[0_0_0_1px_#000]` does too. A link fragment (`href="/x#top"`) is not in brackets.
import { type Finding, filesUnder, scanFiles } from "./files.ts";

const RULE = "class-colours";
const DIRS = ["apps/web/lib", "interfaces/web/src"];
const COLOUR_FUNCTION = "(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\\(";
/** `[` then anything but `]` or a space, then a hex colour or a colour function; or a `[color:` property. */
const ARBITRARY = new RegExp(`\\[[^\\]\\s]*?(?:#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])|${COLOUR_FUNCTION})|\\[color:`, "g");

export function scanClassColours(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    for (const _ of text.matchAll(ARBITRARY)) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

export const scannedFiles = (root: string): string[] => filesUnder(root, DIRS, /\.(?:svelte|ts)$/);

export function scanAll(root: string): Finding[] {
  return scanFiles(root, scannedFiles(root), RULE, scanClassColours);
}
