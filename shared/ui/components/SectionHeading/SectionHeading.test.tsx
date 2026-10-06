// SectionHeading (P1.24): the sheet's SectionHeading (components/SectionHeading/README.md, index.d.ts) as built; no
// differences. The step book mentions a mono `#` eyebrow; sheet v45 shows the index and an em dash instead, and the
// sheet wins.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./SectionHeading.module.css";
import { SectionHeading } from "./SectionHeading.tsx";

describe("SectionHeading", () => {
  it("section_heading_index_and_title", () => {
    expect(renderToStaticMarkup(<SectionHeading index="01" title="Profile" />)).toBe(
      `<div class="${styles.root}"><span class="${styles.index}">01 —</span><h2 class="${styles.title}">Profile</h2></div>`,
    );
    expect(renderToStaticMarkup(<SectionHeading title="Profile" />)).not.toContain(styles.index);
  });
});
