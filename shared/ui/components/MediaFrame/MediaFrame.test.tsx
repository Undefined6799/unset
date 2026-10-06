// MediaFrame (P1.24s): the sheet's MediaFrame (components/MediaFrame/README.md, v41 and v45, index.d.ts) as built.
// Differences from the sheet's d.ts: `src` is a `SafeHref`; no `width` prop (the frame fills its container, and
// the kit sets no inline style).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type SafeHref, safeHref } from "../../safe-href.ts";
import styles from "./MediaFrame.module.css";
import { MediaFrame, type MediaRatio } from "./MediaFrame.tsx";

describe("MediaFrame", () => {
  it("mediaframe_shapes", () => {
    const shapes: Record<MediaRatio, string | undefined> = {
      "1:1": styles.ratio1x1,
      "4:5": styles.ratio4x5,
      "9:16": styles.ratio9x16,
      "16:9": styles.ratio16x9,
      "3:1": styles.ratio3x1,
    };
    for (const [ratio, shape] of Object.entries(shapes)) {
      const html = renderToStaticMarkup(<MediaFrame alt="" ratio={ratio as MediaRatio} />);
      expect(html, ratio).toContain(`<div class="${styles.box} ${shape}">`);
    }
    expect(new Set(Object.values(shapes)).size).toBe(5);
    // @ts-expect-error: a sixth shape is a type error.
    expect(renderToStaticMarkup(<MediaFrame alt="" ratio="2:1" />)).toContain(`<div class="${styles.box}">`);
  });

  it("mediaframe_without_picture_keeps_its_box", () => {
    const html = renderToStaticMarkup(<MediaFrame alt="" ratio="3:1" />);
    expect(html).toBe(
      `<figure class="${styles.root}"><div class="${styles.box} ${styles.ratio3x1}">` +
        `<span class="${styles.empty}">[no image]</span></div></figure>`,
    );
  });

  it("mediaframe_picture_and_caption", () => {
    const src = safeHref("/media/p/1.webp", ["path"]) as SafeHref;
    const html = renderToStaticMarkup(<MediaFrame src={src} alt="a red door" caption="porto, 2025" />);
    expect(html).toContain(`<img class="${styles.image}" src="/media/p/1.webp" alt="a red door" loading="lazy"`);
    expect(html).toContain(`<figcaption class="${styles.caption}">porto, 2025</figcaption>`);
  });
});
