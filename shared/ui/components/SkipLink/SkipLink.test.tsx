// SkipLink (P1.24s): the sheet's SkipLink (components/SkipLink/README.md, v39 and v45, index.d.ts) as built.
// Differences from the sheet's d.ts: `href` admits only a same-page fragment.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./SkipLink.module.css";
import { SkipLink } from "./SkipLink.tsx";

describe("SkipLink", () => {
  it("skiplink_targets_main", () => {
    expect(renderToStaticMarkup(<SkipLink />)).toBe(`<a class="${styles.root}" href="#main">Skip to content</a>`);
    expect(renderToStaticMarkup(<SkipLink shown href="#content" />)).toBe(
      `<a class="${styles.root} ${styles.shown}" href="#content">Skip to content</a>`,
    );
  });
});
