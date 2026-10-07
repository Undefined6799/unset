// Spinner (P1.24a): the sheet's Spinner (components/Spinner/README.md, index.d.ts) as built. Differences from the
// sheet's d.ts: `label` is required, since it is the status screen readers hear; the frames are a CSS animation, not
// a JS timer (book P1.24a), checked moving and still in P1.26's browser harness.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Spinner.module.css";
import { Spinner } from "./Spinner.tsx";

const css = readFileSync(join(import.meta.dirname, "Spinner.module.css"), "utf8");

describe("Spinner", () => {
  it("spinner_text_status_no_js", () => {
    expect(renderToStaticMarkup(<Spinner label="loading…" />)).toBe(
      `<span class="${styles.root}"><span class="${styles.glyph}" aria-hidden="true"></span> ` +
        `<span class="${styles.label}" role="status">loading…</span></span>`,
    );
    expect(css).toMatch(/content: "\|";\s+animation: spin 560ms step-end infinite;/);
    for (const frame of ['"|"', '"/"', '"-"', '"\\\\"']) expect(css).toContain(`content: ${frame};`);
  });

  it("spinner_reduced_motion_static", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s+\.glyph::before \{\s+animation: none;/);
  });
});
