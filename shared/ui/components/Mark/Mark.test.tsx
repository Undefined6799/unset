// Mark (P1.24): the sheet's Mark (components/Mark/README.md, index.d.ts) as built; no differences.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MARK_PATH, Mark } from "./Mark.tsx";

describe("Mark", () => {
  it("mark_geometry_matches_sheet", () => {
    // Read as text, never executed (the icon-source rule): the bundle's own MARK_D literal must equal ours.
    const bundle = readFileSync(join(import.meta.dirname, "..", "..", "sheet", "bundle.js.txt"), "utf8");
    const literals = [...bundle.matchAll(/^ {2}var MARK_D = "([^"]*)";$/gm)].map((m) => m[1]);
    expect(literals).toEqual([MARK_PATH]);
  });

  it("mark_renders_named_svg_at_ratio", () => {
    const html = renderToStaticMarkup(<Mark />);
    expect(html).toMatch(/^<svg class="[^"]+" viewBox="126 430 828 220" width="72" height="19" role="img"/);
    expect(html).toContain('aria-label="unset.sh"');
    expect(html).toContain('fill="currentColor" fill-rule="evenodd"');
    expect(renderToStaticMarkup(<Mark width={828} title="home" />)).toMatch(
      /width="828" height="220".*aria-label="home"/,
    );
  });
});
