// Progress (P1.24a): the sheet's Progress (components/Progress/README.md, index.d.ts) as built. Differences from the
// sheet's d.ts: `label` is required, since it names the real <progress> for screen readers; the drawing is
// aria-hidden and the native element carries the value (book P1.24a).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./Progress.module.css";
import { Progress } from "./Progress.tsx";

/** The text a sighted reader sees: the markup with its tags removed. */
const visible = (html: string) => html.replace(/<progress[^>]*><\/progress>/, "").replace(/<[^>]+>/g, "");

describe("Progress", () => {
  it("progress_text_and_native", () => {
    const html = renderToStaticMarkup(<Progress value={50} width={10} label="uploading" />);
    expect(html).toBe(
      `<label class="${styles.root}"><span aria-hidden="true"><span class="${styles.rule}">[</span>` +
        `<span class="${styles.done}">#####</span><span class="${styles.rule}">-----]</span> 50%</span> ` +
        `<span class="${styles.label}">uploading</span>` +
        `<progress class="visually-hidden" value="50" max="100"></progress></label>`,
    );
    expect(visible(html)).toBe("[#####-----] 50% uploading");
  });

  it("progress_clamps_and_rounds", () => {
    expect(visible(renderToStaticMarkup(<Progress value={13} label="x" />))).toBe("[###-----------------] 13% x");
    expect(renderToStaticMarkup(<Progress value={150} max={120} width={4} label="x" />)).toContain(
      `####</span><span class="${styles.rule}">]</span> 100%`,
    );
    expect(renderToStaticMarkup(<Progress value={-5} width={4} label="x" />)).toContain('value="0"');
  });
});
