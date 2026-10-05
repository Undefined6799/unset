// Turns a group's directives into the Content-Security-Policy text (P1.08 step 4): the directives in one fixed order,
// each directive's sources sorted, joined with "; ". A directive with no sources is left out.
import type { Directives } from "./sources.ts";
import { renderSource } from "./sources.ts";

/** The order directives appear in, so a policy's text never changes with object key order. */
const ORDER = [
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "media-src",
  "font-src",
  "connect-src",
  "form-action",
  "base-uri",
  "frame-ancestors",
  "object-src",
  "manifest-src",
  "require-trusted-types-for",
  "trusted-types",
  "sandbox",
] as const satisfies readonly (keyof Directives)[];

export function buildCsp(directives: Directives): string {
  const parts: string[] = [];
  for (const name of ORDER) {
    const value = directives[name];
    if (value === undefined) continue;
    if (value === true) {
      parts.push(name);
      continue;
    }
    if (value.length === 0) continue;
    const sources = [...new Set(value.map(renderSource))].sort();
    parts.push(`${name} ${sources.join(" ")}`);
  }
  return parts.join("; ");
}
