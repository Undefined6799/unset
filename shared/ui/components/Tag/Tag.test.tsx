// Tag (P1.24): the sheet's Tag (components/Tag/README.md, index.d.ts) as built; no differences.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Tag.module.css";
import { Tag } from "./Tag.tsx";

describe("Tag", () => {
  it("tag_prints_brackets_and_status_word", () => {
    expect(renderToStaticMarkup(<Tag status="err" />)).toBe(`<span class="${styles.root} ${styles.err}">[err]</span>`);
    expect(renderToStaticMarkup(<Tag />)).toBe(`<span class="${styles.root} ${styles.plain}">[plain]</span>`);
    expect(renderToStaticMarkup(<Tag status="ok">live</Tag>)).toBe(
      `<span class="${styles.root} ${styles.ok}">[live]</span>`,
    );
  });
});
