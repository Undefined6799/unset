// Guard (P1.08i): no component writes an inline `style` attribute. P1.08's CSP sets `style-src` to the assets path,
// which also blocks `style="…"`, so sizes go in width/height attributes or CSS Modules instead (plan §5.1, §5.8).
// A simple scanner: the text inside a comment or a string matches too, so reword it. No exemptions.
import { type Finding, filesUnder, scanFiles } from "./files.ts";

export const SCANNED_DIRS = ["apps", "interfaces", "domains", "infrastructure", "shared"] as const;
const RULE = "inline-style";
const INLINE_STYLE = /\bstyle=[{"']/;

export function scanInlineStyle(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (INLINE_STYLE.test(text)) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, filesUnder(root, SCANNED_DIRS, /\.tsx$/), RULE, scanInlineStyle);
}
